import { describe, expect, it } from 'vitest'
import { MemoryLedgerStore, type ContractView, type DeliveryRow } from '@ledger/core'
import { createContract, dispatchCore, seedDicts } from './support.js'

/** 登记交付命令输出形状。 */
interface DeliveryRecordData {
  delivery: DeliveryRow
  contract: ContractView
}

/** 删除交付命令输出形状。 */
interface DeliveryDeleteData {
  id: string
  contractId: string
  contract: ContractView
}

/**
 * 构造带字典与一份合同的测试库。
 * @returns 存储与合同
 */
async function setup(): Promise<{ store: MemoryLedgerStore; contract: ContractView }> {
  const store = new MemoryLedgerStore()
  seedDicts(store)
  const contract = await createContract(store, { amountCents: 100000 })
  return { store, contract }
}

describe('delivery.record', () => {
  it('已交付与已验收明细都计入已交付金额与最后交付日', async () => {
    const { store, contract } = await setup()
    const first = await dispatchCore(store, 'delivery.record', {
      contractId: contract.id,
      date: '2026-03-01',
      amountCents: 30000,
      status: 'delivered',
    })
    expect(first.ok).toBe(true)
    const second = await dispatchCore(store, 'delivery.record', {
      contractId: contract.id,
      date: '2026-04-01',
      amountCents: 20000,
      status: 'accepted',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const data = second.data as DeliveryRecordData
    expect(data.contract.deliveredCents).toBe(50000)
    expect(data.contract.deliveryPercent).toBe(50)
    expect(data.contract.lastDeliveryDate).toBe('2026-04-01')
    expect(store.state().deliveries).toHaveLength(2)
  })

  it('验收驳回明细保留但不计入已交付金额', async () => {
    const { store, contract } = await setup()
    const result = await dispatchCore(store, 'delivery.record', {
      contractId: contract.id,
      date: '2026-03-01',
      amountCents: 10000,
      status: 'rejected',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = result.data as DeliveryRecordData
    expect(data.delivery.status).toBe('rejected')
    expect(data.contract.deliveredCents).toBe(0)
    expect(data.contract.deliveryPercent).toBe(0)
    expect(data.contract.lastDeliveryDate).toBeNull()
    expect(store.state().deliveries).toHaveLength(1)
  })

  it('非驳回明细超过合同剩余可交付金额时返回 DELIVERY_EXCEEDS_CONTRACT_AMOUNT', async () => {
    const { store, contract } = await setup()
    const result = await dispatchCore(store, 'delivery.record', {
      contractId: contract.id,
      date: '2026-03-01',
      amountCents: 100001,
      status: 'delivered',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DELIVERY_EXCEEDS_CONTRACT_AMOUNT')
    expect(store.state().deliveries).toHaveLength(0)
  })
})

describe('delivery.list / delete', () => {
  it('删除一条交付明细后按剩余记录重算已交付金额与最后交付日', async () => {
    const { store, contract } = await setup()
    const first = await dispatchCore(store, 'delivery.record', {
      contractId: contract.id,
      date: '2026-03-01',
      amountCents: 30000,
      status: 'delivered',
    })
    await dispatchCore(store, 'delivery.record', {
      contractId: contract.id,
      date: '2026-04-01',
      amountCents: 20000,
      status: 'accepted',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const delivery = (first.data as DeliveryRecordData).delivery

    const list = await dispatchCore(store, 'delivery.list', { contractId: contract.id })
    expect(list.ok).toBe(true)
    if (!list.ok) return
    expect((list.data as { items: DeliveryRow[] }).items).toHaveLength(2)

    const removed = await dispatchCore(store, 'delivery.delete', { id: delivery.id })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    const data = removed.data as DeliveryDeleteData
    expect(data.contract.deliveredCents).toBe(20000)
    expect(data.contract.lastDeliveryDate).toBe('2026-04-01')
    expect(store.state().deliveries).toHaveLength(1)
  })

  it('删除不存在的交付明细返回 NOT_FOUND', async () => {
    const { store } = await setup()
    const result = await dispatchCore(store, 'delivery.delete', {
      id: '99999999-9999-4999-8999-999999999999',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_FOUND')
  })
})
