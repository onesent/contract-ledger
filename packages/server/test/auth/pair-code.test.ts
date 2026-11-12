import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAIR_CODE_LENGTH,
  DEFAULT_PAIR_CODE_MAX_ATTEMPTS,
  DEFAULT_PAIR_CODE_TTL_MS,
  PAIR_CODE_ALPHABET,
  PairingCodeService,
} from '../../src/index.js'

const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z')

/** 与目标码不同的 8 位错误码。 */
function wrongCodeFor(code: string): string {
  return code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA'
}

describe('配对码字母表与签发', () => {
  it('字母表为 32 个无歧义字符，不含 0/O/1/I', () => {
    expect(PAIR_CODE_ALPHABET).toHaveLength(32)
    expect(new Set(PAIR_CODE_ALPHABET).size).toBe(32)
    for (const char of '0O1I') {
      expect(PAIR_CODE_ALPHABET).not.toContain(char)
    }
  })

  it('签发的码长度正确、字符均来自字母表且 TTL 为 120 秒', () => {
    const service = new PairingCodeService({ now: () => BASE_MS })
    const issued = service.issue()
    expect(issued.code).toHaveLength(DEFAULT_PAIR_CODE_LENGTH)
    for (const char of issued.code) {
      expect(PAIR_CODE_ALPHABET).toContain(char)
    }
    expect(issued.expiresAt).toBe(new Date(BASE_MS + DEFAULT_PAIR_CODE_TTL_MS).toISOString())
    expect(service.isActive()).toBe(true)
  })

  it('支持自定义长度与尝试次数', () => {
    const service = new PairingCodeService({
      now: () => BASE_MS,
      codeLength: 6,
      maxAttempts: 2,
      ttlMs: 5000,
    })
    const issued = service.issue()
    expect(issued.code).toHaveLength(6)
    expect(issued.expiresAt).toBe(new Date(BASE_MS + 5000).toISOString())
  })
})

describe('配对码校验', () => {
  it('成功校验一次后立即烧毁，第二次返回 PAIR_CODE_INVALID', () => {
    const service = new PairingCodeService({ now: () => BASE_MS })
    const { code } = service.issue()
    expect(service.verify(code)).toEqual({ ok: true })
    expect(service.isActive()).toBe(false)
    expect(service.verify(code)).toEqual({
      ok: false,
      code: 'PAIR_CODE_INVALID',
      attemptsLeft: 0,
    })
  })

  it('忽略首尾空格与大小写', () => {
    const service = new PairingCodeService({ now: () => BASE_MS })
    const { code } = service.issue()
    expect(service.verify(`  ${code.toLowerCase()}  `)).toEqual({ ok: true })
  })

  it('过期后返回 PAIR_CODE_INVALID', () => {
    let nowMs = BASE_MS
    const service = new PairingCodeService({ now: () => nowMs })
    const { code } = service.issue()
    nowMs += DEFAULT_PAIR_CODE_TTL_MS
    expect(service.verify(code)).toEqual({
      ok: false,
      code: 'PAIR_CODE_INVALID',
      attemptsLeft: 0,
    })
    expect(service.isActive()).toBe(false)
  })

  it('未签发或已作废时返回 PAIR_CODE_INVALID', () => {
    const service = new PairingCodeService({ now: () => BASE_MS })
    expect(service.verify('AAAAAAAA')).toEqual({
      ok: false,
      code: 'PAIR_CODE_INVALID',
      attemptsLeft: 0,
    })
    const { code } = service.issue()
    service.revoke()
    expect(service.isActive()).toBe(false)
    expect(service.verify(code)).toEqual({
      ok: false,
      code: 'PAIR_CODE_INVALID',
      attemptsLeft: 0,
    })
  })

  it('连续 5 次错误后返回 RATE_LIMITED，并停止继续校验', () => {
    const service = new PairingCodeService({ now: () => BASE_MS })
    const { code } = service.issue()
    const wrong = wrongCodeFor(code)

    for (let attempt = 1; attempt < DEFAULT_PAIR_CODE_MAX_ATTEMPTS; attempt += 1) {
      expect(service.verify(wrong)).toEqual({
        ok: false,
        code: 'PAIR_CODE_INVALID',
        attemptsLeft: DEFAULT_PAIR_CODE_MAX_ATTEMPTS - attempt,
      })
    }
    expect(service.verify(wrong)).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
      attemptsLeft: 0,
    })
    expect(service.isActive()).toBe(false)
    // 超限后即使输入正确也不再校验。
    expect(service.verify(code)).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
      attemptsLeft: 0,
    })
  })

  it('超限状态在配对码过期后结束，随后按无效处理', () => {
    let nowMs = BASE_MS
    const service = new PairingCodeService({ now: () => nowMs, maxAttempts: 1 })
    const { code } = service.issue()
    expect(service.verify('ZZZZZZZZ')).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
      attemptsLeft: 0,
    })
    nowMs += DEFAULT_PAIR_CODE_TTL_MS
    expect(service.verify(code)).toEqual({
      ok: false,
      code: 'PAIR_CODE_INVALID',
      attemptsLeft: 0,
    })
  })

  it('重新签发会作废旧码并重置错误次数', () => {
    const service = new PairingCodeService({ now: () => BASE_MS })
    const first = service.issue()
    const wrong = wrongCodeFor(first.code)
    service.verify(wrong)
    service.verify(wrong)
    expect(service.isActive()).toBe(true)

    const second = service.issue()
    expect(second.code).not.toBe(first.code)
    // 旧码现在只是错误输入：重新签发已重置错误次数。
    expect(service.verify(first.code)).toEqual({
      ok: false,
      code: 'PAIR_CODE_INVALID',
      attemptsLeft: DEFAULT_PAIR_CODE_MAX_ATTEMPTS - 1,
    })
    expect(service.verify(second.code)).toEqual({ ok: true })
  })

  it('同一时间只有最新签发的配对码有效', () => {
    let counter = 0
    const service = new PairingCodeService({
      now: () => BASE_MS,
      randomInt: () => {
        const value = counter % PAIR_CODE_ALPHABET.length
        counter += 1
        return value
      },
    })
    const first = service.issue()
    const second = service.issue()
    expect(second.code).not.toBe(first.code)
    expect(service.verify(first.code)).toEqual({
      ok: false,
      code: 'PAIR_CODE_INVALID',
      attemptsLeft: DEFAULT_PAIR_CODE_MAX_ATTEMPTS - 1,
    })
    expect(service.verify(second.code)).toEqual({ ok: true })
  })
})
