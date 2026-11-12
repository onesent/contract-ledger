import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WriteOptions } from '@ledger/core'
import { auditRows } from '../src/index.js'
import {
  contractRow,
  countTable,
  createTestContext,
  disposeContext,
  seedDicts,
  writeOptions,
  type TestContext,
} from './helpers.js'

describe('审计日志', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
    seedDicts(ctx)
    ctx.contracts.insert(contractRow({ id: 'c-1', no: 'HT-1' }))
  })

  afterEach(() => {
    disposeContext(ctx)
  })

  it('每次成功写入追加一行审计，含 actor/transport/command 与版本区间', async () => {
    await ctx.store.write(
      () => ({ result: { ok: true } }),
      writeOptions({
        actor: 'alice',
        command: 'payment.record',
        transport: 'cli',
        idempotencyKey: 'k-audit',
      }),
    )

    const rows = auditRows(ctx.db)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    if (!row) throw new Error('审计行应存在')
    expect(row.actor).toBe('alice')
    expect(row.transport).toBe('cli')
    expect(row.command).toBe('payment.record')
    expect(row.idempotency_key).toBe('k-audit')
    expect(row.summary).toBe('v0→v1')
    expect(row.before_json).toBe('{"version":0}')
    expect(row.after_json).toBe('{"version":1}')
  })

  it('多次写入按顺序记录版本区间', async () => {
    await ctx.store.write(() => ({ result: 1 }), writeOptions({ idempotencyKey: 'k-1' }))
    await ctx.store.write(() => ({ result: 2 }), writeOptions({ idempotencyKey: 'k-2' }))

    const rows = auditRows(ctx.db)
    expect(rows.map((row) => row.summary)).toEqual(['v0→v1', 'v1→v2'])
    expect(countTable(ctx.db, 'audit_log')).toBe(2)
  })

  it('未指定 transport 时记为 internal', async () => {
    const options: WriteOptions = {
      actor: 'bob',
      command: 'contract.create',
      idempotencyKey: 'k-internal',
      inputFingerprint: 'fp-internal',
    }
    await ctx.store.write(() => ({ result: { ok: true } }), options)

    const row = auditRows(ctx.db)[0]
    if (!row) throw new Error('审计行应存在')
    expect(row.transport).toBe('internal')
  })
})
