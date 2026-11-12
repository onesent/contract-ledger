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

const PAYMENT_INPUT = { contractId: CONTRACT_ID, date: '2026-02-01', amountCents: 1000 }

describe('乐观并发', () => {
  it('expectedVersion 与当前版本不一致时返回 STALE_WRITE 与 currentVersion', async () => {
    const { store, registry } = setup()
    const result = await dispatch(registry, 'payment.record', PAYMENT_INPUT, {
      store,
      actor: 'agent:test',
      transport: 'cli',
      idempotencyKey: 'stale-1',
      expectedVersion: 5,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('STALE_WRITE')
    expect(result.details).toMatchObject({ currentVersion: 0 })
    const state = store.state()
    expect(state.payments).toHaveLength(0)
    expect(state.version).toBe(0)
    expect(state.audits).toHaveLength(0)
  })

  it('expectedVersion 正确时版本只递增一次', async () => {
    const { store, registry } = setup()
    const first = await dispatch(registry, 'payment.record', PAYMENT_INPUT, {
      store,
      actor: 'agent:test',
      transport: 'cli',
      idempotencyKey: 'version-1',
      expectedVersion: 0,
    })
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.version).toBe(1)
    expect(store.state().version).toBe(1)

    const second = await dispatch(
      registry,
      'payment.record',
      { ...PAYMENT_INPUT, amountCents: 2000 },
      {
        store,
        actor: 'agent:test',
        transport: 'cli',
        idempotencyKey: 'version-2',
        expectedVersion: 0,
      },
    )
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.code).toBe('STALE_WRITE')
      expect(second.details).toMatchObject({ currentVersion: 1 })
    }
    expect(store.state().version).toBe(1)
    expect(store.state().payments).toHaveLength(1)
  })
})
