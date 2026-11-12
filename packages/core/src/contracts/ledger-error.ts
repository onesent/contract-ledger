import type { ErrorCode } from './error-codes.js'

/**
 * 存储层抛出的领域错误：携带稳定错误码与可选的上下文（如当前版本号）。
 * 命令分发器与各传输适配器只认 `code`，不解析 message。
 */
export class LedgerError extends Error {
  readonly code: ErrorCode
  readonly details: unknown

  /**
   * @param code 稳定错误码
   * @param message 面向人的说明
   * @param details 结构化上下文（如 { currentVersion }）
   */
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'LedgerError'
    this.code = code
    this.details = details
  }
}
