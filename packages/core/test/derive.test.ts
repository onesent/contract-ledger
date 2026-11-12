import { describe, expect, it } from 'vitest'
import {
  buildContractView,
  deriveReminders,
  deriveStats,
  deliveryPercent,
  executionGap,
  fundingPercent,
  gapState,
  isDueSoon,
  isOverdue,
  isStale,
  REMINDER_GROUPS,
  type DeriveContract,
} from '@ledger/core'

const TODAY = '2026-06-15'

/**
 * 构造测试用合同（默认执行中、无付款/交付）。
 * @param overrides 覆盖字段
 * @returns 合同
 */
function makeContract(
  overrides: Partial<DeriveContract> & Pick<DeriveContract, 'id' | 'direction' | 'amountCents'>,
): DeriveContract {
  return {
    id: overrides.id,
    no: overrides.no ?? overrides.id,
    counterparty: overrides.counterparty ?? '客户',
    ownerName: overrides.ownerName ?? '张伟',
    direction: overrides.direction,
    amountCents: overrides.amountCents,
    paidCents: overrides.paidCents ?? 0,
    deliveredCents: overrides.deliveredCents ?? 0,
    receivedAmountCents: overrides.receivedAmountCents,
    statusCode: overrides.statusCode ?? 'executing',
    signDate: overrides.signDate ?? '2026-01-01',
    dueDate: overrides.dueDate ?? '2026-12-31',
    startDate: overrides.startDate,
    paymentDate: overrides.paymentDate,
    lastPaymentDate: overrides.lastPaymentDate,
    lastDeliveryDate: overrides.lastDeliveryDate,
    statusChangedAt: overrides.statusChangedAt,
    updatedAt: overrides.updatedAt,
    createdAt: overrides.createdAt,
  }
}

describe('fundingPercent / deliveryPercent', () => {
  it('合同金额为 0 时返回 null', () => {
    expect(fundingPercent({ amountCents: 0, paidCents: 0 })).toBeNull()
    expect(deliveryPercent({ amountCents: 0, deliveredCents: 0 })).toBeNull()
  })

  it('按旧版口径返回 30% / 100%，超 100% 夹紧为 100%', () => {
    expect(fundingPercent({ amountCents: 1000, paidCents: 300 })).toBe(30)
    expect(fundingPercent({ amountCents: 1000, paidCents: 1000 })).toBe(100)
    expect(fundingPercent({ amountCents: 1000, paidCents: 1500 })).toBe(100)
    expect(deliveryPercent({ amountCents: 1000, deliveredCents: 250 })).toBe(25)
  })
})

describe('executionGap / gapState', () => {
  it('错位差额 = 已付 − 已交付', () => {
    expect(executionGap({ paidCents: 300, deliveredCents: 100 })).toBe(200)
    expect(executionGap({ paidCents: 100, deliveredCents: 300 })).toBe(-200)
  })

  it('四种错位状态与旧版一致', () => {
    expect(gapState({ amountCents: 0, paidCents: 0, deliveredCents: 0 })).toBe('none')
    expect(gapState({ amountCents: 1000, paidCents: 0, deliveredCents: 0 })).toBe('none')
    expect(gapState({ amountCents: 1000, paidCents: 500, deliveredCents: 500 })).toBe('balanced')
    expect(gapState({ amountCents: 1000, paidCents: 600, deliveredCents: 500 })).toBe('prepaid')
    expect(gapState({ amountCents: 1000, paidCents: 400, deliveredCents: 500 })).toBe('receivable')
  })
})

describe('isOverdue', () => {
  it('今天不算逾期，昨天算，明天不算', () => {
    expect(isOverdue({ dueDate: TODAY, statusCode: 'executing', today: TODAY })).toBe(false)
    expect(isOverdue({ dueDate: '2026-06-14', statusCode: 'executing', today: TODAY })).toBe(true)
    expect(isOverdue({ dueDate: '2026-06-16', statusCode: 'executing', today: TODAY })).toBe(false)
  })

  it('已完结/已终止不判逾期，非法日期返回 false', () => {
    expect(isOverdue({ dueDate: '2026-01-01', statusCode: 'finished', today: TODAY })).toBe(false)
    expect(isOverdue({ dueDate: '2026-01-01', statusCode: 'terminated', today: TODAY })).toBe(false)
    expect(isOverdue({ dueDate: '2026-02-30', statusCode: 'executing', today: TODAY })).toBe(false)
  })
})

describe('isDueSoon', () => {
  it('包含今天，截止今天 + reminderDays', () => {
    expect(isDueSoon({ dueDate: TODAY, today: TODAY, reminderDays: 30 })).toBe(true)
    expect(isDueSoon({ dueDate: '2026-07-15', today: TODAY, reminderDays: 30 })).toBe(true)
    expect(isDueSoon({ dueDate: '2026-07-16', today: TODAY, reminderDays: 30 })).toBe(false)
    expect(isDueSoon({ dueDate: '2026-06-14', today: TODAY, reminderDays: 30 })).toBe(false)
  })

  it('提供状态时排除已结束合同', () => {
    expect(
      isDueSoon({ dueDate: TODAY, today: TODAY, reminderDays: 30, statusCode: 'finished' }),
    ).toBe(false)
  })
})

describe('isStale', () => {
  it('严格超过 staleDays 才算长期未变更', () => {
    expect(
      isStale({ statusChangedAt: '2026-03-17T00:00:00.000Z', today: TODAY, staleDays: 90 }),
    ).toBe(false)
    expect(
      isStale({ statusChangedAt: '2026-03-16T00:00:00.000Z', today: TODAY, staleDays: 90 }),
    ).toBe(true)
  })

  it('非执行中状态不判长期未变更', () => {
    expect(
      isStale({
        statusChangedAt: '2026-01-01T00:00:00.000Z',
        today: TODAY,
        staleDays: 90,
        statusCode: 'finished',
      }),
    ).toBe(false)
  })
})

describe('deriveStats', () => {
  const sale = makeContract({
    id: 'sale-1',
    direction: 'sale',
    amountCents: 100_000,
    paidCents: 30_000,
    signDate: '2026-06-01',
    dueDate: '2026-06-15',
    statusChangedAt: '2026-06-10T00:00:00.000Z',
  })
  const purchase = makeContract({
    id: 'purchase-1',
    direction: 'purchase',
    amountCents: 200_000,
    paidCents: 0,
    deliveredCents: 50_000,
    signDate: '2026-05-01',
    dueDate: '2026-06-16',
    statusChangedAt: '2026-06-10T00:00:00.000Z',
  })

  it('销售与采购分别统计，金额永不相加', () => {
    const stats = deriveStats([sale, purchase], TODAY)
    expect(stats.sale.contractCount).toBe(1)
    expect(stats.purchase.contractCount).toBe(1)
    expect(stats.sale.totalAmountCents).toBe(100_000)
    expect(stats.purchase.totalAmountCents).toBe(200_000)
    expect(stats.sale.receivedAmountCents).toBe(30_000)
    expect(stats.purchase.receivedAmountCents).toBe(0)
    expect(stats.sale.fundingPercent).toBe(30)
    expect(stats.purchase.deliveryPercent).toBe(25)
    expect(stats.sale.statusCounts).toEqual({ executing: 1 })
    expect(stats.purchase.statusCounts).toEqual({ executing: 1 })
  })

  it('临期与本月新签按方向分别计数', () => {
    const stats = deriveStats([sale, purchase], TODAY)
    expect(stats.sale.dueSoonCount).toBe(1)
    expect(stats.purchase.dueSoonCount).toBe(1)
    expect(stats.sale.monthSignedCount).toBe(1)
    expect(stats.purchase.monthSignedCount).toBe(0)
    expect(stats.sale.overdueCount).toBe(0)
    expect(stats.purchase.overdueCount).toBe(0)
  })

  it('逾期未付金额只计入对应方向', () => {
    const overduePurchase = makeContract({
      id: 'purchase-late',
      direction: 'purchase',
      amountCents: 50_000,
      paidCents: 10_000,
      dueDate: '2026-05-01',
      lastPaymentDate: '2026-05-01',
    })
    const stats = deriveStats([sale, purchase, overduePurchase], TODAY)
    expect(stats.sale.overdueUnpaidAmountCents).toBe(0)
    expect(stats.purchase.overdueUnpaidAmountCents).toBe(40_000)
    expect(stats.purchase.overdueCount).toBe(1)
  })
})

describe('deriveReminders', () => {
  it('分组顺序与旧版一致，合同落入对应分类', () => {
    const dueSoon = makeContract({
      id: 'due',
      direction: 'sale',
      amountCents: 1000,
      dueDate: TODAY,
    })
    const overdue = makeContract({
      id: 'late',
      direction: 'purchase',
      amountCents: 2000,
      dueDate: '2026-06-10',
    })
    const reminders = deriveReminders([dueSoon, overdue], [], TODAY, {})
    expect(reminders.map((item) => item.key)).toEqual(REMINDER_GROUPS.map((group) => group.key))
    const dueSoonGroup = reminders.find((item) => item.key === 'dueSoon')
    expect(dueSoonGroup?.items.some((item) => item.id === 'due')).toBe(true)
    const overdueGroup = reminders.find((item) => item.key === 'overdue')
    expect(overdueGroup?.items.some((item) => item.id === 'late')).toBe(true)
  })

  it('忽略键只影响可见数量，不改变总数', () => {
    const dueSoon = makeContract({ id: 'due', direction: 'sale', amountCents: 1000, dueDate: TODAY })
    const reminders = deriveReminders([dueSoon], [], TODAY, {
      ignoredReminders: ['dueSoon:due'],
    })
    const group = reminders.find((item) => item.key === 'dueSoon')
    expect(group?.count).toBe(0)
    expect(group?.totalCount).toBe(1)
    expect(group?.ignoredCount).toBe(1)
  })

  it('数据质量异常附带原因列表', () => {
    const broken = makeContract({
      id: 'broken',
      direction: 'sale',
      amountCents: 1000,
      signDate: '2026-01-01',
      startDate: '2026-12-31',
      dueDate: '2026-01-01',
    })
    const group = deriveReminders([broken], [], TODAY, {}).find((item) => item.key === 'dataQuality')
    expect(group?.items[0]?.issues).toContain('到期日早于开始日期')
  })
})

describe('buildContractView', () => {
  it('补齐未付、进度、错位与旧前端兼容别名', () => {
    const view = buildContractView({
      contract: {
        id: 'c1',
        no: 'HT-001',
        direction: 'sale',
        counterparty: '客户',
        typeCode: 'sales',
        statusCode: 'executing',
        amountCents: 1000,
        signDate: '2026-01-01',
        startDate: '2026-01-01',
        dueDate: '2026-12-31',
        statusChangedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      paidCents: 300,
      deliveredCents: 100,
      lastDeliveryDate: '2026-06-01',
    })
    expect(view.receivedAmountCents).toBe(300)
    expect(view.paidCents).toBe(300)
    expect(view.unpaidCents).toBe(700)
    expect(view.fundingPercent).toBe(30)
    expect(view.deliveryPercent).toBe(10)
    expect(view.executionGapCents).toBe(200)
    expect(view.gapState).toBe('prepaid')
    expect(view.lastDeliveryDate).toBe('2026-06-01')
  })

  it('开账余额与流水/明细合计相加（与 SQL 视图口径一致）', () => {
    const view = buildContractView({
      contract: {
        id: 'c2',
        direction: 'purchase',
        counterparty: '供应商',
        statusCode: 'executing',
        amountCents: 1000,
        signDate: '2026-01-01',
        dueDate: '2026-12-31',
        openingPaidCents: 100,
        openingDeliveredCents: 50,
      },
      paidCents: 200,
      deliveredCents: 50,
    })
    expect(view.paidCents).toBe(300)
    expect(view.deliveredCents).toBe(100)
    expect(view.openingPaidCents).toBe(100)
    expect(view.openingDeliveredCents).toBe(50)
  })
})
