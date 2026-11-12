import type { ErrorCode } from '@ledger/core'

/** 成功退出码。 */
export const EXIT_OK = 0

/** 业务失败：命令已执行但被领域规则拒绝，或服务内部错误。 */
export const EXIT_BUSINESS = 1

/** 用法错误：CLI 参数不合法、未知选项、未知子命令或入参校验失败。 */
export const EXIT_USAGE = 2

/** 未认证 / 认证失效 / 配对码无效。 */
export const EXIT_AUTH = 4

/** 认证类错误码统一映射到退出码 4。 */
const AUTH_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'PAIR_CODE_INVALID',
])

/**
 * 把稳定错误码映射为进程退出码。
 * @param code 领域错误码
 * @returns 认证类 → 4；参数校验类 → 2；其余业务失败 → 1
 */
export function exitCodeForErrorCode(code: ErrorCode): number {
  if (AUTH_ERROR_CODES.has(code)) {
    return EXIT_AUTH
  }
  if (code === 'VALIDATION_FAILED') {
    return EXIT_USAGE
  }
  return EXIT_BUSINESS
}
