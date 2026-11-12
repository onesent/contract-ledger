import { afterEach, describe, expect, it } from 'vitest'
import { deliveryPercent, executionGap, fundingPercent, gapState } from '@ledger/core'
import {
  contractRow,
  createTestContext,
  deliveryRow,
  disposeContext,
  paymentRow,
  readView,
  seedDicts,
  type TestContext,
} from './helpers.js'

let ctx: TestContext | undefined

afterEach(() => {
  if (ctx) disposeContext(ctx)
  ctx = undefined
})

interface ParityCase {
  id: string
  no: string
  amountCents: number
  openingPaidCents: number
  paymentCents: number
  deliveryCents: number
}

/**
 * 跨包一致性：SQL 视图与 core 纯函数必须给出相同的派生值。
 * 覆盖除不尽的小数、开账余额与零金额三种情况。
 */
describe('派生值与 SQL 视图一致', () => {
  it('百分比、错位差额与错位状态逐项一致', async () => {
    ctx = await createTestContext()
    seedDicts(ctx)

    const cases: ParityCase[] = [
      { id: 'c1', no: 'HT-P1', amountCents: 3000, openingPaidCents: 0, paymentCents: 1000, deliveryCents: 600 },
      { id: 'c2', no: 'HT-P2', amountCents: 0, openingPaidCents: 0, paymentCents: 0, deliveryCents: 0 },
      { id: 'c3', no: 'HT-P3', amountCents: 700, openingPaidCents: 100, paymentCents: 100, deliveryCents: 0 },
    ]

    for (const item of cases) {
      ctx.contracts.insert(
        contractRow({
          id: item.id,
          no: item.no,
          amountCents: item.amountCents,
          openingPaidCents: item.openingPaidCents,
        }),
      )
      if (item.paymentCents > 0) {
        ctx.payments.insert(
          paymentRow({ id: `pay-${item.id}`, contractId: item.id, amountCents: item.paymentCents }),
        )
      }
      if (item.deliveryCents > 0) {
        ctx.deliveries.insert(
          deliveryRow({ id: `dev-${item.id}`, contractId: item.id, amountCents: item.deliveryCents }),
        )
      }
    }

    for (const item of cases) {
      const row = readView(ctx, item.id)
      expect(row.funding_percent).toBe(
        fundingPercent({ amountCents: item.amountCents, paidCents: row.paid_cents }),
      )
      expect(row.delivery_percent).toBe(
        deliveryPercent({ amountCents: item.amountCents, deliveredCents: row.delivered_cents }),
      )
      expect(row.execution_gap_cents).toBe(
        executionGap({ paidCents: row.paid_cents, deliveredCents: row.delivered_cents }),
      )
      expect(row.gap_state).toBe(
        gapState({
          amountCents: item.amountCents,
          paidCents: row.paid_cents,
          deliveredCents: row.delivered_cents,
        }),
      )
    }

    expect(readView(ctx, 'c1').funding_percent).toBe(33.33)
    expect(readView(ctx, 'c2').funding_percent).toBeNull()
    expect(readView(ctx, 'c3').funding_percent).toBe(28.57)
  })
})
