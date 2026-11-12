import { describe, expect, it } from 'vitest'
import { dispatch, MemoryLedgerStore } from '@ledger/core'
import { CONTRACT_ID, createTestRegistry, makeContract } from './support.js'

/**
 * 创建已插入一份测试合同的内存库与注册表。
 * @returns 存储与注册表
 */
function setup(): { store: MemoryLedgerStore; registry: ReturnType<typeof createTestRegistry> } {
  const store = new MemoryLedgerStore()
  store.contracts.insert(makeContract())
  return { store, registry: createTestRegistry() }
}

describe('dry-run', () => {
  it('handler 写入后返回 diff，但合同、版本、审计均不变', async () => {
    const { store, registry } = setup()
    const result = await dispatch(
      registry,
      'contract.adjust',
      { id: CONTRACT_ID, amountCents: 120000 },
      { store, actor: 'agent:test', transport: 'cli', dryRun: true, idempotencyKey: 'dry-1' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diff).toEqual({ amountCents: { from: 100000, to: 120000 } })
    expect(result.version).toBe(0)
    expect(result.meta.dryRun).toBe(true)

    const state = store.state()
    expect(state.contracts[0]?.amountCents).toBe(100000)
    expect(state.version).toBe(0)
    expect(state.audits).toHaveLength(0)
    expect(state.idempotency).toHaveLength(0)
  })

  it('dry-run 新增流水不落库', async () => {
    const { store, registry } = setup()
    const result = await dispatch(
      registry,
      'payment.record',
      { contractId: CONTRACT_ID, date: '2026-02-01', amountCents: 5000 },
      { store, actor: 'agent:test', transport: 'cli', dryRun: true, idempotencyKey: 'dry-2' },
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.version).toBe(0)
    const state = store.state()
    expect(state.payments).toHaveLength(0)
    expect(state.version).toBe(0)
    expect(state.audits).toHaveLength(0)
    expect(state.idempotency).toHaveLength(0)
  })
})
