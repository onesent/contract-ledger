/**
 * 进程内固定窗口限流器：按「来源 + 路由类别」计数，超限返回可重试秒数。
 * 仅用于本地回环服务；无需持久化，重启即清空。
 */
export interface RateLimitRule {
  limit: number
  windowMs: number
}

/** 单次检查结果。 */
export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

/** 内存固定窗口限流器。 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  /**
   * @param now 可注入时钟（毫秒）
   */
  constructor(private readonly now: () => number) {}

  /**
   * 记录一次命中并判断是否超限。
   * @param key 来源 + 路由键
   * @param rule 限制规则
   * @returns 是否允许以及超限时的重试秒数
   */
  check(key: string, rule: RateLimitRule): RateLimitResult {
    const current = this.now()
    const cutoff = current - rule.windowMs
    const previous = this.hits.get(key) ?? []
    const fresh = previous.filter((timestamp) => timestamp > cutoff)
    if (fresh.length >= rule.limit) {
      const oldest = fresh[0] ?? current
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + rule.windowMs - current) / 1000),
      )
      this.hits.set(key, fresh)
      return { allowed: false, retryAfterSeconds }
    }
    fresh.push(current)
    this.hits.set(key, fresh)
    return { allowed: true }
  }
}

/** 配对接口限流规则：5 次/分钟。 */
export const PAIR_RATE_RULE: RateLimitRule = { limit: 5, windowMs: 60_000 }

/** 一般认证请求限流规则：30 次/分钟。 */
export const AUTH_RATE_RULE: RateLimitRule = { limit: 30, windowMs: 60_000 }
