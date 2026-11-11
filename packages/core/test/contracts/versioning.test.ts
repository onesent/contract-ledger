import { describe, expect, it } from 'vitest'
import { checkExpectedVersion } from '@ledger/core'

describe('checkExpectedVersion', () => {
  it('未提供期望版本时放行', () => {
    expect(checkExpectedVersion(7, undefined)).toBeNull()
  })

  it('期望版本与当前版本一致时放行', () => {
    expect(checkExpectedVersion(7, 7)).toBeNull()
  })

  it('期望版本落后时返回 STALE_WRITE', () => {
    expect(checkExpectedVersion(7, 6)).toBe('STALE_WRITE')
  })

  it('期望版本超前时同样返回 STALE_WRITE', () => {
    expect(checkExpectedVersion(7, 8)).toBe('STALE_WRITE')
  })
})
