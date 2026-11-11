import { describe, expect, it } from 'vitest'
import { ERROR_CATALOG } from '@ledger/core'

const EXPECTED_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'DUPLICATE_NO',
  'STALE_WRITE',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'PAYMENT_EXCEEDS_CONTRACT_AMOUNT',
  'DELIVERY_EXCEEDS_CONTRACT_AMOUNT',
  'AMOUNT_BELOW_PAID',
  'AMOUNT_BELOW_DELIVERED',
  'CONTRACT_DIRECTION_LOCKED',
  'OWNER_INACTIVE',
  'REFERENCE_IN_USE',
  'READONLY',
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'PAIR_CODE_INVALID',
  'RATE_LIMITED',
  'HOST_REJECTED',
  'ORIGIN_REJECTED',
  'DB_BUSY',
  'QUERY_REJECTED',
  'INTERNAL',
]

describe('ERROR_CATALOG', () => {
  it('覆盖全部冻结错误码且没有多余条目', () => {
    expect(new Set(Object.keys(ERROR_CATALOG))).toEqual(new Set(EXPECTED_CODES))
  })

  it('每个错误码都有正数 HTTP 状态与非空中文修复建议', () => {
    for (const [code, definition] of Object.entries(ERROR_CATALOG)) {
      expect(definition.httpStatus, `${code} httpStatus`).toBeGreaterThan(0)
      expect(definition.hint.trim().length, `${code} hint`).toBeGreaterThan(0)
      expect(definition.hint, `${code} hint 应为中文`).toMatch(/[\u4e00-\u9fa5]/)
    }
  })

  it('仅 DB_BUSY 与 RATE_LIMITED 标记为可重试', () => {
    const retryable = Object.entries(ERROR_CATALOG)
      .filter(([, definition]) => definition.retryable)
      .map(([code]) => code)
      .sort()
    expect(retryable).toEqual(['DB_BUSY', 'RATE_LIMITED'])
  })
})
