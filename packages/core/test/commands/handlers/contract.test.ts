import { describe, expect, it } from 'vitest'
import { MemoryLedgerStore, type ContractView } from '@ledger/core'
import {
  createContract,
  dispatchCore,
  makeContractInput,
  seedDicts,
  seedPersonnel,
} from './support.js'

/** 合同详情命令输出形状。 */
interface ContractDetailData {
  contract: ContractView
  payments: unknown[]
  deliveries: unknown[]
  statusLogs: Array<{ fromCode: string; toCode: string; changedAt: string; actor: string; note: string }>
}

/** 合同列表命令输出形状。 */
interface ContractListData {
  items: ContractView[]
  total: number
  page: number
  pageSize: number
}

/**
 * 构造带字典的内存库。
 * @returns 存储与字典 id
 */
function setup(): { store: MemoryLedgerStore; ids: ReturnType<typeof seedDicts> } {
  const store = new MemoryLedgerStore()
  return { store, ids: seedDicts(store) }
}

describe('contract.upsert / get / list', () => {
  it('创建后可按编号读取详情，列表支持分页与排序', async () => {
    const { store } = setup()
    const first = await createContract(store, { no: 'HT-A', amountCents: 100000 })
    const second = await createContract(store, { no: 'HT-B', amountCents: 300000 })
    await createContract(store, { no: 'HT-C', amountCents: 200000 })

    const detail = await dispatchCore(store, 'contract.get', { no: 'HT-B' })
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    const data = detail.data as ContractDetailData
    expect(data.contract.id).toBe(second.id)
    expect(data.payments).toHaveLength(0)
    expect(data.deliveries).toHaveLength(0)
    expect(data.statusLogs).toHaveLength(1)
    expect(data.statusLogs[0]).toMatchObject({ fromCode: '', toCode: 'executing', actor: 'agent:test' })

    const page1 = await dispatchCore(store, 'contract.list', {
      page: 1,
      pageSize: 2,
      sortBy: 'amountCents',
      sortOrder: 'desc',
    })
    expect(page1.ok).toBe(true)
    if (!page1.ok) return
    const list = page1.data as ContractListData
    expect(list.total).toBe(3)
    expect(list.page).toBe(1)
    expect(list.pageSize).toBe(2)
    expect(list.items.map((item) => item.amountCents)).toEqual([300000, 200000])
    expect(list.items[0]?.id).toBe(second.id)

    const page2 = await dispatchCore(store, 'contract.list', {
      page: 2,
      pageSize: 2,
      sortBy: 'amountCents',
      sortOrder: 'desc',
    })
    if (!page2.ok) return
    const secondPage = page2.data as ContractListData
    expect(secondPage.items.map((item) => item.amountCents)).toEqual([100000])
    expect(secondPage.items[0]?.id).toBe(first.id)
  })

  it('pageSize 超过 200 时夹紧为 200', async () => {
    const { store } = setup()
    await createContract(store, { no: 'HT-CLAMP' })
    const result = await dispatchCore(store, 'contract.list', { page: 1, pageSize: 9999 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data as ContractListData).pageSize).toBe(200)
  })
})

describe('contract.upsert 校验', () => {
  it('合同编号忽略大小写重复时返回 DUPLICATE_NO', async () => {
    const { store } = setup()
    await createContract(store, { no: 'HT-DUP' })
    const result = await dispatchCore(
      store,
      'contract.upsert',
      makeContractInput({ no: 'ht-dup', amountCents: 200000 }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DUPLICATE_NO')
  })

  it('负责人已离职时返回 OWNER_INACTIVE', async () => {
    const { store } = setup()
    const owner = seedPersonnel(store, { active: false, code: 'P-INACTIVE' })
    const result = await dispatchCore(
      store,
      'contract.upsert',
      makeContractInput({ ownerId: owner.id }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('OWNER_INACTIVE')
  })

  it('到期日早于开始日时返回 VALIDATION_FAILED', async () => {
    const { store } = setup()
    const result = await dispatchCore(
      store,
      'contract.upsert',
      makeContractInput({ startDate: '2026-06-01', dueDate: '2026-05-01' }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION_FAILED')
  })
})

describe('contract.upsert 更新守卫', () => {
  it('合同金额低于已付金额时返回 AMOUNT_BELOW_PAID', async () => {
    const { store } = setup()
    const contract = await createContract(store, { amountCents: 100000 })
    const payment = await dispatchCore(store, 'payment.record', {
      contractId: contract.id,
      date: '2026-02-01',
      amountCents: 60000,
    })
    expect(payment.ok).toBe(true)
    const result = await dispatchCore(
      store,
      'contract.upsert',
      makeContractInput({ id: contract.id, amountCents: 50000 }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('AMOUNT_BELOW_PAID')
  })

  it('合同金额低于已交付金额时返回 AMOUNT_BELOW_DELIVERED', async () => {
    const { store } = setup()
    const contract = await createContract(store, { amountCents: 100000 })
    const delivery = await dispatchCore(store, 'delivery.record', {
      contractId: contract.id,
      date: '2026-03-01',
      amountCents: 40000,
      status: 'delivered',
    })
    expect(delivery.ok).toBe(true)
    const result = await dispatchCore(
      store,
      'contract.upsert',
      makeContractInput({ id: contract.id, amountCents: 30000 }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('AMOUNT_BELOW_DELIVERED')
  })

  it('已有执行记录时修改方向返回 CONTRACT_DIRECTION_LOCKED', async () => {
    const { store } = setup()
    const contract = await createContract(store, { direction: 'sale' })
    await dispatchCore(store, 'payment.record', {
      contractId: contract.id,
      date: '2026-02-01',
      amountCents: 1000,
    })
    const result = await dispatchCore(
      store,
      'contract.upsert',
      makeContractInput({ id: contract.id, direction: 'purchase', typeCode: 'purchase' }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CONTRACT_DIRECTION_LOCKED')
  })
})

describe('contract 状态变更', () => {
  it('状态变化写入状态日志并刷新 statusChangedAt', async () => {
    const { store } = setup()
    const created = await createContract(store, { statusCode: 'executing' })
    const changed = await dispatchCore(
      store,
      'contract.upsert',
      makeContractInput({ id: created.id, statusCode: 'finished' }),
    )
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    const view = (changed.data as { contract: ContractView }).contract
    expect(view.statusCode).toBe('finished')
    expect(view.statusChangedAt).not.toBeNull()

    const detail = await dispatchCore(store, 'contract.get', { id: created.id })
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    const data = detail.data as ContractDetailData
    expect(data.statusLogs).toHaveLength(2)
    expect(data.statusLogs[0]).toMatchObject({ fromCode: '', toCode: 'executing' })
    expect(data.statusLogs[1]).toMatchObject({ fromCode: 'executing', toCode: 'finished' })
    expect(data.statusLogs[1]?.note).toBe('状态变更')
  })

  it('状态不变时不追加日志', async () => {
    const { store } = setup()
    const created = await createContract(store, { statusCode: 'executing' })
    const updated = await dispatchCore(
      store,
      'contract.upsert',
      makeContractInput({ id: created.id, projectName: '改名项目', statusCode: 'executing' }),
    )
    expect(updated.ok).toBe(true)
    const detail = await dispatchCore(store, 'contract.get', { id: created.id })
    if (!detail.ok) return
    expect((detail.data as ContractDetailData).statusLogs).toHaveLength(1)
  })
})
