import { describe, expect, it } from 'vitest'
import { dispatch, MemoryLedgerStore } from '@ledger/core'
import { CONTRACT_ID, createTestRegistry, makeContract } from './support.js'

describe('批量命令原子性', () => {
  it('handler 插入 2 笔付款后抛错 → 两笔都不落库', async () => {
    const store = new MemoryLedgerStore()
    store.contracts.insert(makeContract())
    const registry = createTestRegistry()

    const result = await dispatch(
      registry,
      'payment.batch',
      { contractId: CONTRACT_ID, amounts: [1000, 2000, 3000] },
      { store, actor: 'agent:test', transport: 'cli', idempotencyKey: 'batch-1' },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION_FAILED')
    expect(result.details).toEqual({ index: 1 })

    const state = store.state()
    expect(state.payments).toHaveLength(0)
    expect(state.version).toBe(0)
    expect(state.audits).toHaveLength(0)
    expect(state.idempotency).toHaveLength(0)
  })
})
