import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getContractView, listContractViews } from '../src/index.js'
import {
  contractRow,
  createTestContext,
  deliveryRow,
  dictItem,
  disposeContext,
  expectThrowMessage,
  paymentRow,
  personnelRow,
  readView,
  seedDicts,
  type TestContext,
} from './helpers.js'

describe('SQLite 仓储与约束', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
    seedDicts(ctx)
  })

  afterEach(() => {
    disposeContext(ctx)
  })

  it('外键拒绝：流水引用不存在的合同', () => {
    expectThrowMessage(
      () => ctx.payments.insert(paymentRow({ id: 'pay-orphan', contractId: 'missing-contract' })),
      'FOREIGN KEY constraint failed',
    )
  })

  it('唯一键拒绝：合同编号重复', () => {
    ctx.contracts.insert(contractRow({ id: 'c-1', no: 'HT-DUP' }))
    expectThrowMessage(
      () => ctx.contracts.insert(contractRow({ id: 'c-2', no: 'HT-DUP' })),
      'UNIQUE constraint failed: contracts.no',
    )
  })

  it('唯一键拒绝：同一分类下字典 code 重复', () => {
    expectThrowMessage(
      () => ctx.dicts.insertItem(dictItem('item-dup', 'contractType', 'sales', '重复销售合同')),
      'UNIQUE constraint failed: dict_items.category_id, dict_items.code',
    )
  })

  it('资金守卫：开账 + 流水累计超过合同金额被拒绝', () => {
    ctx.contracts.insert(
      contractRow({ id: 'c-pay', no: 'HT-PAY', amountCents: 1000, openingPaidCents: 200 }),
    )
    ctx.payments.insert(paymentRow({ id: 'pay-ok', contractId: 'c-pay', amountCents: 800 }))
    expectThrowMessage(
      () => ctx.payments.insert(paymentRow({ id: 'pay-over', contractId: 'c-pay', amountCents: 1 })),
      'PAYMENT_EXCEEDS_CONTRACT_AMOUNT',
    )
  })

  it('交付守卫：非 rejected 累计超过合同金额被拒绝，rejected 放行', () => {
    ctx.contracts.insert(contractRow({ id: 'c-del', no: 'HT-DEL', amountCents: 1000 }))
    ctx.deliveries.insert(deliveryRow({ id: 'del-ok', contractId: 'c-del', amountCents: 900 }))
    expectThrowMessage(
      () => ctx.deliveries.insert(deliveryRow({ id: 'del-over', contractId: 'c-del', amountCents: 200 })),
      'DELIVERY_EXCEEDS_CONTRACT_AMOUNT',
    )
    // rejected 不计入已交付，允许超过金额。
    ctx.deliveries.insert(
      deliveryRow({ id: 'del-rejected', contractId: 'c-del', amountCents: 5000, status: 'rejected' }),
    )
    expect(readView(ctx, 'c-del').delivered_cents).toBe(900)
  })

  it('合同降额到低于已付金额被拒绝', () => {
    ctx.contracts.insert(contractRow({ id: 'c-down-paid', no: 'HT-DOWN-PAID', amountCents: 1000 }))
    ctx.payments.insert(paymentRow({ id: 'pay-down', contractId: 'c-down-paid', amountCents: 600 }))
    const current = ctx.contracts.getById('c-down-paid')
    if (!current) throw new Error('合同应存在')
    expectThrowMessage(
      () => ctx.contracts.update({ ...current, amountCents: 500 }),
      'AMOUNT_BELOW_PAID',
    )
  })

  it('合同降额到低于已交付金额被拒绝', () => {
    ctx.contracts.insert(contractRow({ id: 'c-down-del', no: 'HT-DOWN-DEL', amountCents: 1000 }))
    ctx.deliveries.insert(deliveryRow({ id: 'del-down', contractId: 'c-down-del', amountCents: 600 }))
    const current = ctx.contracts.getById('c-down-del')
    if (!current) throw new Error('合同应存在')
    expectThrowMessage(
      () => ctx.contracts.update({ ...current, amountCents: 500 }),
      'AMOUNT_BELOW_DELIVERED',
    )
  })

  it('删除合同级联删除流水与交付明细', () => {
    ctx.contracts.insert(contractRow({ id: 'c-cascade', no: 'HT-CASCADE' }))
    ctx.payments.insert(paymentRow({ id: 'pay-cascade', contractId: 'c-cascade', amountCents: 100 }))
    ctx.deliveries.insert(deliveryRow({ id: 'del-cascade', contractId: 'c-cascade', amountCents: 100 }))
    ctx.contracts.delete('c-cascade')
    expect(ctx.contracts.getById('c-cascade')).toBeNull()
    expect(ctx.payments.listByContract('c-cascade')).toEqual([])
    expect(ctx.deliveries.listByContract('c-cascade')).toEqual([])
  })

  it('删除被合同引用的字典项被拒绝', () => {
    ctx.contracts.insert(contractRow({ id: 'c-dict-ref', no: 'HT-DICT-REF' }))
    expectThrowMessage(
      () => ctx.dicts.deleteItem('item-type-sales'),
      'FOREIGN KEY constraint failed',
    )
  })

  it('合同视图读取：筛选、分页、按编号与 id 查询', () => {
    ctx.personnel.insert(personnelRow({ id: 'person-1', code: 'YG-001', name: '张伟' }))
    ctx.contracts.insert(
      contractRow({ id: 'c-a', no: 'HT-A', ownerId: 'person-1', ownerName: '张伟', amountCents: 10000 }),
    )
    ctx.contracts.insert(
      contractRow({
        id: 'c-b',
        no: 'HT-B',
        projectName: '采购服务器',
        direction: 'purchase',
        typeItemId: 'item-type-purchase',
        statusItemId: 'item-status-finished',
        counterparty: '供应商甲',
      }),
    )
    ctx.contracts.insert(
      contractRow({ id: 'c-c', no: 'HT-C', counterparty: '另一客户', projectName: '另一个项目' }),
    )
    ctx.payments.insert(paymentRow({ id: 'pay-a', contractId: 'c-a', amountCents: 4000 }))
    ctx.deliveries.insert(deliveryRow({ id: 'del-a', contractId: 'c-a', amountCents: 2500 }))

    expect(ctx.contracts.list({ direction: 'purchase' }).map((row) => row.id)).toEqual(['c-b'])
    expect(ctx.contracts.list({ statusCode: 'finished' }).map((row) => row.id)).toEqual(['c-b'])
    expect(ctx.contracts.list({ ownerId: 'person-1' }).map((row) => row.id)).toEqual(['c-a'])
    expect(ctx.contracts.list({ search: '供应商' }).map((row) => row.id)).toEqual(['c-b'])
    expect(ctx.contracts.list({ limit: 2 })).toHaveLength(2)
    expect(ctx.contracts.list({ limit: 2, offset: 2 })).toHaveLength(1)

    const byNo = ctx.contracts.getByNo('HT-A')
    expect(byNo?.id).toBe('c-a')
    expect(byNo?.paidCents).toBe(4000)
    expect(byNo?.receivedAmountCents).toBe(4000)
    expect(byNo?.deliveredCents).toBe(2500)
    expect(byNo?.typeCode).toBe('sales')
    expect(byNo?.statusCode).toBe('executing')
    expect(byNo?.ownerName).toBe('张伟')
    expect(byNo?.fundingPercent).toBe(40)

    expect(getContractView(ctx.runtime, 'c-a')?.id).toBe('c-a')
    expect(listContractViews(ctx.runtime, { direction: 'sale' })).toHaveLength(2)
  })

  it('人员仓储：部门名称实时取字典，默认过滤离职', () => {
    ctx.personnel.insert(personnelRow({ id: 'person-active', code: 'YG-001', name: '张伟' }))
    ctx.personnel.insert(
      personnelRow({ id: 'person-left', code: 'YG-002', name: '刘洋', active: false, deptCode: 'delivery' }),
    )

    const active = ctx.personnel.list()
    expect(active.map((row) => row.id)).toEqual(['person-active'])
    expect(active[0]?.deptName).toBe('销售部')

    const all = ctx.personnel.list(true)
    expect(all).toHaveLength(2)
    expect(all.find((row) => row.id === 'person-left')?.deptName).toBe('交付部')

    const first = ctx.personnel.getById('person-active')
    if (!first) throw new Error('人员应存在')
    ctx.personnel.update({ ...first, name: '张伟（更新）' })
    expect(ctx.personnel.getById('person-active')?.name).toBe('张伟（更新）')
  })

  it('字典仓储：分类、findItem 与 listItems', () => {
    const categories = ctx.dicts.listCategories()
    expect(categories.map((row) => row.code)).toEqual([
      'contractStatus',
      'contractType',
      'department',
      'payMethod',
    ])

    const item = ctx.dicts.findItem('contractType', 'sales')
    expect(item?.id).toBe('item-type-sales')
    expect(item?.categoryCode).toBe('contractType')
    expect(ctx.dicts.findItem('contractType', 'missing')).toBeNull()

    const statusItems = ctx.dicts.listItems('contractStatus')
    expect(statusItems.map((row) => row.code)).toEqual(['executing', 'finished'])
    expect(ctx.dicts.listItems()).toHaveLength(7)
    expect(ctx.dicts.getItemById('item-dept-sales')?.name).toBe('销售部')
  })
})
