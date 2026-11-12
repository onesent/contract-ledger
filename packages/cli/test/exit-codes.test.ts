import { describe, expect, it } from 'vitest'
import { ERROR_CATALOG, type ErrorCode } from '@ledger/core'
import { EXIT_AUTH, EXIT_BUSINESS, EXIT_OK, EXIT_USAGE, exitCodeForErrorCode } from '@ledger/cli'

describe('退出码常量', () => {
  it('冻结 0 / 1 / 2 / 4', () => {
    expect(EXIT_OK).toBe(0)
    expect(EXIT_BUSINESS).toBe(1)
    expect(EXIT_USAGE).toBe(2)
    expect(EXIT_AUTH).toBe(4)
  })
})

describe('exitCodeForErrorCode', () => {
  it('认证类错误码映射到 4', () => {
    expect(exitCodeForErrorCode('AUTH_REQUIRED')).toBe(EXIT_AUTH)
    expect(exitCodeForErrorCode('AUTH_INVALID')).toBe(EXIT_AUTH)
    expect(exitCodeForErrorCode('PAIR_CODE_INVALID')).toBe(EXIT_AUTH)
  })

  it('参数校验错误码映射到 2', () => {
    expect(exitCodeForErrorCode('VALIDATION_FAILED')).toBe(EXIT_USAGE)
  })

  it('其余业务 / 内部错误码映射到 1', () => {
    const businessCodes: ErrorCode[] = [
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
      'RATE_LIMITED',
      'HOST_REJECTED',
      'ORIGIN_REJECTED',
      'DB_BUSY',
      'QUERY_REJECTED',
      'INTERNAL',
    ]
    for (const code of businessCodes) {
      expect(exitCodeForErrorCode(code), code).toBe(EXIT_BUSINESS)
    }
  })

  it('覆盖错误码目录中的每一个条目', () => {
    for (const code of Object.keys(ERROR_CATALOG) as ErrorCode[]) {
      expect([EXIT_BUSINESS, EXIT_USAGE, EXIT_AUTH]).toContain(exitCodeForErrorCode(code))
    }
  })
})
