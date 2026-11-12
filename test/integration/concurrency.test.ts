/**
 * 8.2 并发写入：两个独立 better-sqlite3 连接（各自运行在独立工作线程）竞争同一文件库。
 *
 * 为什么使用工作线程：better-sqlite3 的 busy_timeout 是同步阻塞等待，
 * 同一事件循环内的两个连接会在微任务边界互相饿死；只有独立线程/进程才能
 * 验证真实的锁等待、STALE_WRITE 与“无部分写入”。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ERROR_CATALOG, dispatch, type CommandResult } from '@ledger/core'
import {
  contractInput,
  createIntegrationContext,
  expectFailure,
  expectSuccess,
  isCommandResult,
  isRecord,
  readNumber,
  readRecord,
  readString,
  type IntegrationContext,
} from './helpers.js'
import type {
  ConcurrencyWorkerRequest,
  ConcurrencyWorkerResponse,
} from './concurrency-worker.js'

/** 工作线程序列化后的结果消息。 */
function parseResponse(value: unknown): ConcurrencyWorkerResponse | null {
  if (!isRecord(value)) return null
  if (value.kind === 'fatal') {
    return typeof value.message === 'string' ? { kind: 'fatal', message: value.message } : null
  }
  if (value.kind !== 'result') return null
  const result = value.result
  if (!isCommandResult(result)) return null
  return { kind: 'result', result }
}

/**
 * 启动一个工作线程执行一条命令。
 * @param request 文件、命令、入参与幂等键
 * @returns 命令统一信封
 */
function runWorker(request: ConcurrencyWorkerRequest): Promise<CommandResult<unknown>> {
  const worker = new Worker(new URL('./concurrency-worker.ts', import.meta.url), {
    workerData: request,
  })
  return new Promise<CommandResult<unknown>>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      if (settled) return
      settled = true
      void worker.terminate()
    }
    worker.once('message', (message: unknown) => {
      cleanup()
      const parsed = parseResponse(message)
      if (parsed === null) {
        reject(new Error('工作线程返回了无法识别的消息。'))
        return
      }
      if (parsed.kind === 'fatal') {
        reject(new Error(`工作线程致命错误：${parsed.message}`))
        return
      }
      resolve(parsed.result)
    })
    worker.once('error', (error: Error) => {
      cleanup()
      reject(error)
    })
  })
}

/**
 * 读取命令信封中的合同视图。
 * @param result 命令结果
 * @returns 合同视图
 */
function readContractView(result: CommandResult<unknown>): Record<string, unknown> {
  const success = expectSuccess(result)
  if (!isRecord(success.data)) throw new Error('命令结果 data 不是对象。')
  return readRecord(success.data, 'contract')
}

describe('8.2 并发写入', () => {
  let ctx: IntegrationContext

  beforeAll(async () => {
    const coreDist = fileURLToPath(new URL('../../packages/core/dist/index.js', import.meta.url))
    if (!existsSync(coreDist)) {
      throw new Error('并发集成测试需要先构建 packages/*：请先执行 npm run typecheck。')
    }
    ctx = await createIntegrationContext()
  })

  afterAll(() => {
    ctx.dispose()
  })

  it(
    '同一 expectedVersion 的并发更新只有一个成功，另一个返回 STALE_WRITE 与当前版本',
    async () => {
      const created = await dispatch(
        ctx.registry,
        'contract.upsert',
        contractInput({ no: 'HT-CONC-1', amountCents: 100_000 }),
        { store: ctx.store, actor: 'main', transport: 'cli', idempotencyKey: 'conc-create-1' },
      )
      const contractId = readString(readContractView(created), 'id')
      const expected = ctx.store.getVersion()
      const base = { ...contractInput({ no: 'HT-CONC-1', amountCents: 100_000 }), id: contractId }

      const [first, second] = await Promise.all([
        runWorker({
          file: ctx.file,
          command: 'contract.upsert',
          input: { ...base, amountCents: 110_000 },
          actor: 'worker-a',
          idempotencyKey: 'conc-update-a',
          expectedVersion: expected,
        }),
        runWorker({
          file: ctx.file,
          command: 'contract.upsert',
          input: { ...base, amountCents: 120_000 },
          actor: 'worker-b',
          idempotencyKey: 'conc-update-b',
          expectedVersion: expected,
        }),
      ])

      const results = [first, second]
      const failures = results.filter((result) => !result.ok)
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(failures).toHaveLength(1)

      const failed = failures[0]
      if (failed === undefined) throw new Error('预期一个失败结果，但未找到。')
      const failure = expectFailure(failed)
      expect(failure.code).toBe('STALE_WRITE')
      expect(Object.hasOwn(ERROR_CATALOG, failure.code)).toBe(true)
      expect(failure.message).not.toContain('SQLITE_BUSY')
      if (!isRecord(failure.details)) throw new Error('STALE_WRITE 缺少 details。')
      expect(readNumber(failure.details, 'currentVersion')).toBe(expected + 1)
      if (failure.code === 'DB_BUSY') expect(failure.retryable).toBe(true)

      expect(ctx.store.getVersion()).toBe(expected + 1)
      const stored = ctx.store.contracts.getById(contractId)
      if (stored === null) throw new Error('并发更新后合同不存在。')
      expect([110_000, 120_000]).toContain(stored.amountCents)
    },
    20_000,
  )

  it(
    '无 expectedVersion 的并发追加均成功，版本 +2 且最终已付金额正确',
    async () => {
      const created = await dispatch(
        ctx.registry,
        'contract.upsert',
        contractInput({ no: 'HT-CONC-2', amountCents: 100_000 }),
        { store: ctx.store, actor: 'main', transport: 'cli', idempotencyKey: 'conc-create-2' },
      )
      const contractId = readString(readContractView(created), 'id')
      const before = ctx.store.getVersion()

      const [first, second] = await Promise.all([
        runWorker({
          file: ctx.file,
          command: 'payment.record',
          input: { contractId, date: '2026-03-01', amountCents: 30_000 },
          actor: 'worker-a',
          idempotencyKey: 'conc-payment-a',
        }),
        runWorker({
          file: ctx.file,
          command: 'payment.record',
          input: { contractId, date: '2026-03-02', amountCents: 20_000 },
          actor: 'worker-b',
          idempotencyKey: 'conc-payment-b',
        }),
      ])

      expectSuccess(first)
      expectSuccess(second)
      expect(ctx.store.getVersion()).toBe(before + 2)

      const view = ctx.store.contracts.getById(contractId)
      if (view === null) throw new Error('并发追加后合同不存在。')
      expect(view.paidCents).toBe(50_000)
      expect(view.fundingPercent).toBe(50)

      const payments = ctx.db
        .prepare<[string], { id: string; amount_cents: number }>(
          'SELECT id, amount_cents FROM payments WHERE contract_id = ? ORDER BY id ASC',
        )
        .all(contractId)
      expect(payments).toHaveLength(2)
      expect(new Set(payments.map((row) => row.id)).size).toBe(2)
      expect(payments.reduce((sum, row) => sum + row.amount_cents, 0)).toBe(50_000)
    },
    20_000,
  )
})
