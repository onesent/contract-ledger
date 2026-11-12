import { LedgerError } from '@ledger/core'

/** 触发器守卫会抛出的稳定错误码（RAISE(ABORT, '<CODE>')）。 */
const TRIGGER_CODES = [
  'PAYMENT_EXCEEDS_CONTRACT_AMOUNT',
  'DELIVERY_EXCEEDS_CONTRACT_AMOUNT',
  'AMOUNT_BELOW_PAID',
  'AMOUNT_BELOW_DELIVERED',
] as const

const TRIGGER_MESSAGES: Record<(typeof TRIGGER_CODES)[number], string> = {
  PAYMENT_EXCEEDS_CONTRACT_AMOUNT: '本次付款超过合同剩余可付金额。',
  DELIVERY_EXCEEDS_CONTRACT_AMOUNT: '本次交付超过合同剩余可交付金额。',
  AMOUNT_BELOW_PAID: '合同金额不能低于已付金额。',
  AMOUNT_BELOW_DELIVERED: '合同金额不能低于已交付金额。',
}

/** 从 unknown 错误对象读取字符串 code。 */
function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if (!('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

/** 读取错误的 cause（用于识别被包装的 BUSY）。 */
function readErrorCause(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined
  if (!('cause' in error)) return undefined
  return error.cause
}

/** 判断错误链中是否包含 SQLite BUSY 变体。 */
export function isBusyError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5; depth += 1) {
    const code = readErrorCode(current)
    if (code !== undefined && code.startsWith('SQLITE_BUSY')) return true
    current = readErrorCause(current)
    if (current === undefined) return false
  }
  return false
}

/** 构造带 retryable 上下文的 DB_BUSY 领域错误。 */
export function busyError(): LedgerError {
  return new LedgerError('DB_BUSY', '数据库正被其他写入占用，请稍后重试。', { retryable: true })
}

/** 把触发器错误映射为稳定领域错误；非触发器错误返回 null。 */
export function toTriggerError(error: unknown): LedgerError | null {
  if (error instanceof LedgerError) return null
  const message = error instanceof Error ? error.message : ''
  for (const code of TRIGGER_CODES) {
    if (message.includes(code)) {
      return new LedgerError(code, TRIGGER_MESSAGES[code])
    }
  }
  return null
}
