/**
 * 数据集端点：导出剔敏、导入替换计数与只读模式。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { exportDataset } from '@ledger/storage-sqlite'
import {
  BASE_URL,
  contractInput,
  createBearer,
  createContract,
  createHttpTestContext,
  type HttpTestContext,
} from './http-helpers.js'

/** 当前测试上下文。 */
let context: HttpTestContext | null = null

afterEach(() => {
  context?.dispose()
  context = null
})

/**
 * 创建上下文并登记清理。
 * @param readonly 是否只读
 * @returns 测试上下文
 */
async function setup(readonly = false): Promise<HttpTestContext> {
  context = await createHttpTestContext({ readonly })
  return context
}

/** 导出响应结构。 */
interface ExportBody {
  app: string
  schemaVersion: number
  data: {
    contracts: unknown[]
    payments: unknown[]
    deliveries: unknown[]
    personnel: unknown[]
    dicts: unknown[]
    settings: Record<string, unknown>
  }
}

describe('导出', () => {
  it('导出包含全部业务集合并剔除密钥字段', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    await createContract(ctx, token, contractInput({ no: 'HT-EXP-1' }))
    ctx.db
      .prepare<[string, string, string]>(
        `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(
        'ai',
        JSON.stringify({ provider: 'custom', apiKey: 'secret-key', baseUrl: 'https://x', enabled: true }),
        new Date().toISOString(),
      )

    const response = await ctx.app.request(`${BASE_URL}/api/export`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as ExportBody
    expect(body.app).toBe('contract-ledger')
    expect(body.schemaVersion).toBe(3)
    expect(body.data.contracts).toHaveLength(1)
    expect(Array.isArray(body.data.payments)).toBe(true)
    expect(Array.isArray(body.data.deliveries)).toBe(true)
    expect(Array.isArray(body.data.personnel)).toBe(true)
    expect(Array.isArray(body.data.dicts)).toBe(true)

    const ai = body.data.settings.ai
    expect(typeof ai).toBe('object')
    if (typeof ai === 'object' && ai !== null) {
      expect('apiKey' in ai).toBe(false)
      expect('baseUrl' in ai).toBe(false)
      expect('enabled' in ai).toBe(false)
    }
  })
})

describe('导入', () => {
  it('replace 模式返回各集合写入计数', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    await createContract(ctx, token, contractInput({ no: 'HT-IMP-1' }))
    await createContract(ctx, token, contractInput({ no: 'HT-IMP-2' }))
    const payload = exportDataset(ctx.db)

    const response = await ctx.app.request(`${BASE_URL}/api/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dataset: payload, mode: 'replace' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as {
      ok: boolean
      mode: string
      report: { contracts: number; payments: number; dicts: number; skipped: number }
    }
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('replace')
    expect(body.report.contracts).toBe(2)
    expect(body.report.payments).toBe(0)
    expect(body.report.skipped).toBe(0)
  })
})

describe('只读模式', () => {
  it('写命令与导入返回 403 READONLY，导出仍可用', async () => {
    const ctx = await setup(true)
    const token = createBearer(ctx)
    const headers = { authorization: `Bearer ${token}` }

    const exported = await ctx.app.request(`${BASE_URL}/api/export`, { headers })
    expect(exported.status).toBe(200)

    const command = await ctx.app.request(`${BASE_URL}/api/commands/contract.upsert`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': 'readonly-key' },
      body: JSON.stringify(contractInput({ no: 'HT-RO-1' })),
    })
    expect(command.status).toBe(403)
    const commandBody = await command.json() as { code: string }
    expect(commandBody.code).toBe('READONLY')

    const imported = await ctx.app.request(`${BASE_URL}/api/import`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ dataset: exportDataset(ctx.db), mode: 'replace' }),
    })
    expect(imported.status).toBe(403)
    const importBody = await imported.json() as { code: string }
    expect(importBody.code).toBe('READONLY')
  })
})
