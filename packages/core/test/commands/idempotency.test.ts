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

describe('幂等重放', () => {
  it('同键同指纹重放首次结果，不重复写入也不递增版本', async () => {
    const { store, registry } = setup()
    const input = { contractId: CONTRACT_ID, date: '2026-02-01', amountCents: 3000 }
    const options = { store, actor: 'agent:test', transport: 'cli' as const, idempotencyKey: 'replay-1' }

    const first = await dispatch(registry, 'payment.record', input, options)
    const second = await dispatch(registry, 'payment.record', input, options)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.data).toEqual(first.data)
    expect(first.version).toBe(1)
    expect(second.version).toBe(1)

    const state = store.state()
    expect(state.payments).toHaveLength(1)
    expect(state.version).toBe(1)
    expect(state.audits).toHaveLength(1)
    expect(state.idempotency).toHaveLength(1)
  })

  it('同键不同指纹返回 IDEMPOTENCY_KEY_REUSED 且不写入', async () => {
    const { store, registry } = setup()
    const options = { store, actor: 'agent:test', transport: 'cli' as const, idempotencyKey: 'reuse-1' }

    const first = await dispatch(
      registry,
      'payment.record',
      { contractId: CONTRACT_ID, date: '2026-02-01', amountCents: 1000 },
      options,
    )
    const second = await dispatch(
      registry,
      'payment.record',
      { contractId: CONTRACT_ID, date: '2026-02-01', amountCents: 2000 },
      options,
    )

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.code).toBe('IDEMPOTENCY_KEY_REUSED')
      expect(second.retryable).toBe(false)
    }
    const state = store.state()
    expect(state.payments).toHaveLength(1)
    expect(state.payments[0]?.amountCents).toBe(1000)
    expect(state.version).toBe(1)
    expect(state.audits).toHaveLength(1)
  })
})
