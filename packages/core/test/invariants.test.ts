import { describe, expect, it } from 'vitest'
import {
  assertAmountAtLeastCommitted,
  assertContractNoUnique,
  assertDateOrder,
  assertDeliveryWithinContract,
  assertDirectionChangeAllowed,
  assertOwnerActive,
  assertPaymentWithinContract,
  type InvariantResult,
} from '@ledger/core'

/**
 * 断言不变量失败并返回指定错误码。
 * @param result 不变量结果
 * @param code 期望错误码
 */
function expectFailure(result: InvariantResult, code: string): void {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.code).toBe(code)
}

describe('assertContractNoUnique', () => {
  it('编号重复（忽略大小写）时返回 DUPLICATE_NO', () => {
    expectFailure(assertContractNoUnique([{ id: 'c1', no: 'HT-001' }], 'ht-001'), 'DUPLICATE_NO')
  })

  it('更新自身时排除自身并放行', () => {
    const result = assertContractNoUnique([{ id: 'c1', no: 'HT-001' }], 'HT-001', 'c1')
    expect(result.ok).toBe(true)
  })

  it('编号唯一时放行', () => {
    expect(assertContractNoUnique([{ id: 'c1', no: 'HT-001' }], 'HT-002').ok).toBe(true)
  })
})

describe('assertOwnerActive', () => {
  it('负责人离职时返回 OWNER_INACTIVE', () => {
    expectFailure(assertOwnerActive(false), 'OWNER_INACTIVE')
  })

  it('负责人在职时放行', () => {
    expect(assertOwnerActive(true).ok).toBe(true)
  })
})

describe('assertDateOrder', () => {
  it('到期日早于开始日时返回 VALIDATION_FAILED', () => {
    expectFailure(assertDateOrder('2026-02-01', '2026-01-01'), 'VALIDATION_FAILED')
  })

  it('日期顺序正确时放行', () => {
    expect(assertDateOrder('2026-01-01', '2026-02-01').ok).toBe(true)
  })
})

describe('assertAmountAtLeastCommitted', () => {
  it('合同金额低于已付金额时返回 AMOUNT_BELOW_PAID', () => {
    expectFailure(assertAmountAtLeastCommitted(100, 200, 0), 'AMOUNT_BELOW_PAID')
  })

  it('合同金额低于已交付金额时返回 AMOUNT_BELOW_DELIVERED', () => {
    expectFailure(assertAmountAtLeastCommitted(100, 50, 200), 'AMOUNT_BELOW_DELIVERED')
  })

  it('合同金额不低于已付与已交付时放行', () => {
    expect(assertAmountAtLeastCommitted(300, 200, 100).ok).toBe(true)
  })
})

describe('assertDirectionChangeAllowed', () => {
  it('已有执行记录时修改方向返回 CONTRACT_DIRECTION_LOCKED', () => {
    expectFailure(assertDirectionChangeAllowed(true, 'sale', 'purchase'), 'CONTRACT_DIRECTION_LOCKED')
  })

  it('无执行记录或方向未变时放行', () => {
    expect(assertDirectionChangeAllowed(false, 'sale', 'purchase').ok).toBe(true)
    expect(assertDirectionChangeAllowed(true, 'sale', 'sale').ok).toBe(true)
  })
})

describe('assertPaymentWithinContract', () => {
  it('累计付款超过合同金额时返回 PAYMENT_EXCEEDS_CONTRACT_AMOUNT', () => {
    expectFailure(
      assertPaymentWithinContract(100, 90, 20),
      'PAYMENT_EXCEEDS_CONTRACT_AMOUNT',
    )
  })

  it('未超过时放行', () => {
    expect(assertPaymentWithinContract(100, 90, 10).ok).toBe(true)
  })
})

describe('assertDeliveryWithinContract', () => {
  it('累计交付超过合同金额时返回 DELIVERY_EXCEEDS_CONTRACT_AMOUNT', () => {
    expectFailure(
      assertDeliveryWithinContract(100, 90, 20),
      'DELIVERY_EXCEEDS_CONTRACT_AMOUNT',
    )
  })

  it('未超过时放行', () => {
    expect(assertDeliveryWithinContract(100, 90, 10).ok).toBe(true)
  })
})
