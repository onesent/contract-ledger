import { ERROR_CATALOG, type ErrorCode } from './error-codes.js'

/** 请求来源通道；同一信封在三种外部通道与内部调用间保持一致。 */
export type Transport = 'cli' | 'http' | 'mcp' | 'web' | 'internal'

/** 所有结果共用的元信息（camelCase 为内部契约，CLI 输出时由适配器转 snake_case）。 */
export interface ResultMeta {
  requestId: string
  durationMs: number
  dryRun: boolean
  actor: string
  transport: Transport
}

/** 成功结果：携带新版本号；dryRun 时 diff 描述将要发生的变更。 */
export interface SuccessResult<T> {
  ok: true
  data: T
  version: number
  diff?: unknown
  meta: ResultMeta
}

/** 失败结果：code 稳定、message 面向人、hint 面向下一步操作。 */
export interface FailureResult {
  ok: false
  code: ErrorCode
  message: string
  hint?: string
  details?: unknown
  retryable: boolean
  meta: ResultMeta
}

/** 统一命令结果信封；成功与失败以 ok 判别。 */
export type CommandResult<T> = SuccessResult<T> | FailureResult

/** CLI 专属信封：只额外增加 schema_version 与 command，不改变结果语义。 */
export type CliEnvelope = { schema_version: 1; command: string } & CommandResult<unknown>

/** 成功结果构造参数。 */
export interface SuccessInput<T> {
  data: T
  version: number
  meta: ResultMeta
  diff?: unknown
}

/** 失败结果构造参数；hint 缺省时取错误码目录中的可执行建议。 */
export interface FailureInput {
  code: ErrorCode
  message: string
  meta: ResultMeta
  hint?: string
  details?: unknown
}

/**
 * 构造成功结果；未提供 diff 时不写出该字段。
 * @param input 数据、版本与元信息
 * @returns 成功信封
 */
export function successResult<T>(input: SuccessInput<T>): SuccessResult<T> {
  if (input.diff === undefined) {
    return { ok: true, data: input.data, version: input.version, meta: input.meta }
  }
  return { ok: true, data: input.data, version: input.version, diff: input.diff, meta: input.meta }
}

/**
 * 构造失败结果；retryable 与默认 hint 由错误码目录统一提供，避免各适配器漂移。
 * @param input 错误码、面向人的消息与元信息
 * @returns 失败信封
 */
export function failureResult(input: FailureInput): FailureResult {
  const definition = ERROR_CATALOG[input.code]
  return {
    ok: false,
    code: input.code,
    message: input.message,
    hint: input.hint ?? definition.hint,
    details: input.details,
    retryable: definition.retryable,
    meta: input.meta,
  }
}
