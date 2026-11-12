import { describe, expect, it } from 'vitest'
import {
  adaptContract,
  adaptDelivery,
  adaptPayment,
  adaptReminderItem,
  adaptStats,
  centsToYuan,
  yuanToCents,
} from '../src/api/mappers'

/**
 * 金额单位映射单测：服务端一律整数分，前端展示层一律元，换算只在边界发生一次。
 * 重点回归 `centsToYuan` 曾写成 `×100/÷100`（原值返回），
 * 导致采购合同列表与详情把 38,400.00 显示成 3,840,000.00，并让付款弹窗预填 100 倍金额。
 */

describe('元 ↔ 分换算', () => {
  it('分 → 元：去掉百分之一，不做二次放大', () => {
    expect(centsToYuan(3840000)).toBe(38400)
    expect(centsToYuan(320000)).toBe(3200)
    expect(centsToYuan(1)).toBe(0.01)
    expect(centsToYuan(0)).toBe(0)
  })

  it('元 → 分：half-up 到分，且与分 → 元互逆', () => {
    expect(yuanToCents(38400)).toBe(3840000)
    expect(yuanToCents(3200)).toBe(320000)
    expect(yuanToCents(0.005)).toBe(1)
    expect(yuanToCents(0.004)).toBe(0)
    for (const cents of [0, 1, 99, 320000, 3840000]) {
      expect(yuanToCents(centsToYuan(cents))).toBe(cents)
    }
  })

  it('非法输入回退 0，不产生 NaN / Infinity', () => {
    expect(centsToYuan(undefined)).toBe(0)
    expect(centsToYuan('abc')).toBe(0)
    expect(centsToYuan(Number.POSITIVE_INFINITY)).toBe(0)
    expect(yuanToCents(null)).toBe(0)
    expect(yuanToCents(Number.NaN)).toBe(0)
  })
})

describe('行映射按元输出', () => {
  /** 合同视图行（服务端分）。 */
  const contractRow = {
    id: 'c1',
    no: 'HT-202601-001',
    counterparty: '广州XXX有限公司',
    amountCents: 3840000,
    paidCents: 3520000,
    unpaidCents: 320000,
    deliveredCents: 0,
    executionGapCents: 3520000,
  }

  it('adaptContract 把合同金额换算为元', () => {
    const row = adaptContract(contractRow)
    expect(row.amount).toBe(38400)
    expect(row.receivedAmount).toBe(35200)
    expect(row.unpaid).toBe(3200)
    expect(row.deliveredAmount).toBe(0)
    expect(row.customer).toBe('广州XXX有限公司')
  })

  it('adaptPayment / adaptDelivery 把流水与交付金额换算为元', () => {
    expect(adaptPayment({ id: 'p1', amountCents: 320000 }).amount).toBe(3200)
    expect(adaptDelivery({ id: 'd1', amountCents: 120050 }).amount).toBe(1200.5)
  })

  it('adaptStats 与 adaptReminderItem 亦按元输出', () => {
    const stats = adaptStats(
      {
        contractCount: 1,
        totalAmountCents: 3840000,
        receivedAmountCents: 3520000,
        deliveredAmountCents: 0,
        unpaidAmountCents: 320000,
        fundingPercent: 91.67,
        deliveryPercent: 0,
        executingCount: 1,
        monthSignedCount: 0,
        monthSignedAmountCents: 0,
        dueSoonCount: 0,
        overdueCount: 0,
        overdueUnpaidAmountCents: 0,
        paymentCount: 11,
        statusCounts: { executing: 1 },
      },
      'purchase',
    )
    expect(stats.totalAmount).toBe(38400)
    expect(stats.receivedAmount).toBe(35200)
    expect(stats.unpaidAmount).toBe(3200)
    expect(stats.paymentRate).toBe(91.67)

    expect(adaptReminderItem({ id: 'r1', unpaidCents: 320000 }).unpaid).toBe(3200)
  })
})
