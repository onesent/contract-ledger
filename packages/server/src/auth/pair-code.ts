import { createHash, randomInt as cryptoRandomInt, timingSafeEqual } from 'node:crypto'

/**
 * 一次性配对码服务。
 *
 * 约束（design D8 / local-service-auth）：
 * - 8 位、32 字符无歧义字母表（去掉 0/O/1/I），TTL 默认 120 秒；
 * - 同时只允许一个有效配对码，重新签发即作废旧码；
 * - 单次使用：校验成功立即烧毁；
 * - 错误次数达到上限后返回 RATE_LIMITED，并停止继续猜测，直到重新签发或过期；
 * - 比较使用定长时间摘要比较，避免按字符提前返回。
 */

/** 无歧义字母表：32 字符，去掉 0 O 1 I。 */
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 默认配对码有效期：120 秒。 */
export const DEFAULT_PAIR_CODE_TTL_MS = 120_000

/** 默认最大错误尝试次数。 */
export const DEFAULT_PAIR_CODE_MAX_ATTEMPTS = 5

/** 默认配对码长度。 */
export const DEFAULT_PAIR_CODE_LENGTH = 8

/** 配对码服务参数。 */
export interface PairingCodeOptions {
  ttlMs?: number
  maxAttempts?: number
  codeLength?: number
  now?: () => number
  randomInt?: (max: number) => number
}

/** 签发结果。 */
export interface IssuedPairingCode {
  code: string
  expiresAt: string
}

/** 校验结果。 */
export type PairingCodeVerifyResult =
  | { ok: true }
  | { ok: false; code: 'PAIR_CODE_INVALID' | 'RATE_LIMITED'; attemptsLeft: number }

/** 当前有效配对码的内部状态。 */
interface ActivePairingCode {
  code: string
  expiresAtMs: number
  attempts: number
  consumed: boolean
  exhausted: boolean
}

/**
 * 定长时间比较两个字符串：先做 SHA-256 摘要，再比较摘要。
 * 该实现与输入长度无关，且不会因首字符不同而提前返回。
 * @param a 字符串
 * @param b 字符串
 * @returns 是否相等
 */
function constantTimeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest()
  const digestB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(digestA, digestB)
}

/**
 * 一次性配对码服务。实例内只保存一个当前配对码。
 */
export class PairingCodeService {
  private readonly ttlMs: number
  private readonly maxAttempts: number
  private readonly codeLength: number
  private readonly now: () => number
  private readonly randomInt: (max: number) => number
  private current: ActivePairingCode | null = null

  constructor(options: PairingCodeOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_PAIR_CODE_TTL_MS
    this.maxAttempts = options.maxAttempts ?? DEFAULT_PAIR_CODE_MAX_ATTEMPTS
    this.codeLength = options.codeLength ?? DEFAULT_PAIR_CODE_LENGTH
    this.now = options.now ?? (() => Date.now())
    this.randomInt = options.randomInt ?? ((max) => cryptoRandomInt(max))
    if (!Number.isInteger(this.codeLength) || this.codeLength <= 0) {
      throw new Error('配对码长度必须是正整数')
    }
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 0) {
      throw new Error('配对码最大尝试次数必须是非负整数')
    }
  }

  /**
   * 生成一个随机字符。
   * @returns 字母表中的一个字符
   */
  private randomChar(): string {
    const index = this.randomInt(PAIR_CODE_ALPHABET.length)
    if (!Number.isInteger(index) || index < 0 || index >= PAIR_CODE_ALPHABET.length) {
      throw new Error('randomInt 返回值越界，无法生成配对码')
    }
    return PAIR_CODE_ALPHABET.charAt(index)
  }

  /**
   * 签发新配对码；旧码立即作废。
   * @returns 新配对码与 ISO 过期时间
   */
  issue(): IssuedPairingCode {
    let code = ''
    for (let i = 0; i < this.codeLength; i += 1) code += this.randomChar()
    const issuedAtMs = this.now()
    const expiresAtMs = issuedAtMs + this.ttlMs
    const expiresAt = new Date(expiresAtMs).toISOString()
    this.current = { code, expiresAtMs, attempts: 0, consumed: false, exhausted: false }
    return { code, expiresAt }
  }

  /**
   * 校验配对码。
   *
   * 判定顺序：无码/过期 → PAIR_CODE_INVALID；已耗尽尝试 → RATE_LIMITED；
   * 已成功使用 → PAIR_CODE_INVALID；匹配则烧毁并成功；否则累计错误次数。
   * @param input 用户输入的配对码（忽略首尾空格与大小写）
   * @returns 校验结果与剩余尝试次数
   */
  verify(input: string): PairingCodeVerifyResult {
    const state = this.current
    if (state === null) {
      return { ok: false, code: 'PAIR_CODE_INVALID', attemptsLeft: 0 }
    }
    if (this.now() >= state.expiresAtMs) {
      this.current = null
      return { ok: false, code: 'PAIR_CODE_INVALID', attemptsLeft: 0 }
    }
    if (state.exhausted) {
      return { ok: false, code: 'RATE_LIMITED', attemptsLeft: 0 }
    }
    if (state.consumed) {
      return { ok: false, code: 'PAIR_CODE_INVALID', attemptsLeft: 0 }
    }

    const normalized = input.trim().toUpperCase()
    if (constantTimeEqual(normalized, state.code)) {
      state.consumed = true
      return { ok: true }
    }

    state.attempts += 1
    const attemptsLeft = Math.max(0, this.maxAttempts - state.attempts)
    if (attemptsLeft === 0) {
      state.exhausted = true
      return { ok: false, code: 'RATE_LIMITED', attemptsLeft: 0 }
    }
    return { ok: false, code: 'PAIR_CODE_INVALID', attemptsLeft }
  }

  /**
   * 作废当前配对码（登出、服务关闭或安全事件时使用）。
   */
  revoke(): void {
    this.current = null
  }

  /**
   * 当前是否存在可用的配对码。
   * @returns 未使用、未耗尽且未过期时为 true
   */
  isActive(): boolean {
    const state = this.current
    if (state === null) return false
    if (state.consumed || state.exhausted) return false
    return this.now() < state.expiresAtMs
  }
}
