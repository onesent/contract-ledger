import { describe, expect, it } from 'vitest'
import { MemoryLedgerStore, type ContractView, type PaymentRow } from '@ledger/core'
import { createContract, dispatchCore, seedDicts } from './support.js'

/** 登记流水命令输出形状。 */
interface PaymentRecordData {
  payment: PaymentRow
  contract: ContractView
}

/** 删除流水命令输出形状。 */
interface PaymentDeleteData {
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

describe('payment.record', () => {
  it('登记后合同视图的已付/未付/资金进度实时更新', async () => {
    const { store, contract } = await setup()
    const result = await dispatchCore(store, 'payment.record', {
      contractId: contract.id,
      date: '2026-02-01',
      amountCents: 25000,
      methodCode: 'transfer',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = result.data as PaymentRecordData
    expect(data.payment.amountCents).toBe(25000)
    expect(data.payment.methodCode).toBe('transfer')
    expect(data.contract.paidCents).toBe(25000)
    expect(data.contract.receivedAmountCents).toBe(25000)
    expect(data.contract.unpaidCents).toBe(75000)
    expect(data.contract.fundingPercent).toBe(25)
    expect(store.state().payments).toHaveLength(1)
  })

  it('累计付款超过合同金额时返回 PAYMENT_EXCEEDS_CONTRACT_AMOUNT 且不写入', async () => {
    const { store, contract } = await setup()
    const result = await dispatchCore(store, 'payment.record', {
      contractId: contract.id,
      date: '2026-02-01',
      amountCents: 100001,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('PAYMENT_EXCEEDS_CONTRACT_AMOUNT')
    expect(store.state().payments).toHaveLength(0)
    expect(store.state().version).toBe(1)
  })

  it('合同不存在时返回 NOT_FOUND', async () => {
    const { store } = await setup()
    const result = await dispatchCore(store, 'payment.record', {
      contractId: '99999999-9999-4999-8999-999999999999',
      date: '2026-02-01',
      amountCents: 1000,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_FOUND')
  })
})

describe('payment.list / delete', () => {
  it('按合同列出流水，删除后合同已付金额回退', async () => {
    const { store, contract } = await setup()
    const recorded = await dispatchCore(store, 'payment.record', {
      contractId: contract.id,
      date: '2026-02-01',
      amountCents: 25000,
    })
    expect(recorded.ok).toBe(true)
    if (!recorded.ok) return
    const payment = (recorded.data as PaymentRecordData).payment

    const list = await dispatchCore(store, 'payment.list', { contractId: contract.id })
    expect(list.ok).toBe(true)
    if (!list.ok) return
    expect((list.data as { items: PaymentRow[] }).items).toHaveLength(1)

    const removed = await dispatchCore(store, 'payment.delete', { id: payment.id })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    const data = removed.data as PaymentDeleteData
    expect(data.contractId).toBe(contract.id)
    expect(data.contract.paidCents).toBe(0)
    expect(data.contract.unpaidCents).toBe(100000)
    expect(data.contract.fundingPercent).toBe(0)
    expect(store.state().payments).toHaveLength(0)
  })

  it('删除不存在的流水返回 NOT_FOUND', async () => {
    const { store } = await setup()
    const result = await dispatchCore(store, 'payment.delete', {
      id: '99999999-9999-4999-8999-999999999999',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_FOUND')
  })
})
