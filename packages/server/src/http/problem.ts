/**
 * RFC 9457 problem+json 响应与命令失败信封转换。
 * 所有错误都带稳定 `code`，状态码统一由 core 的 ERROR_CATALOG 决定。
 */
import { randomUUID } from 'node:crypto'
import {
  ERROR_CATALOG,
  type ErrorCode,
  type FailureResult,
  type ResultMeta,
} from '@ledger/core'

/** problem+json 媒体类型。 */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8'

/** 构造 problem 响应所需字段。 */
export interface ProblemInit {
  code: ErrorCode
  message: string
  hint?: string
  details?: unknown
  /** 覆盖目录中的 HTTP 状态（仅用于框架层 400 等场景）。 */
  status?: number
  retryable?: boolean
  meta?: ResultMeta
  /** 429 响应附带的 Retry-After 秒数。 */
  retryAfterSeconds?: number
}

/**
 * 构造一条请求元信息；框架层错误没有命令结果，因此使用固定结构。
 * @param actor 操作者；未认证时为 anonymous
 * @returns 结果元信息
 */
export function createMeta(actor = 'anonymous'): ResultMeta {
  return {
    requestId: randomUUID(),
    durationMs: 0,
    dryRun: false,
    actor,
    transport: 'http',
  }
}

/**
 * 构造 problem+json 响应。
 * @param init 错误码、消息与可选上下文
 * @returns HTTP 响应
 */
export function problemResponse(init: ProblemInit): Response {
  const definition = ERROR_CATALOG[init.code]
  const status = init.status ?? definition.httpStatus
  const body = {
    type: 'about:blank',
    title: '请求未完成',
    status,
    detail: init.message,
    code: init.code,
    hint: init.hint ?? definition.hint,
    retryable: init.retryable ?? definition.retryable,
    details: init.details ?? null,
    meta: init.meta ?? createMeta(),
  }
  const headers: Record<string, string> = { 'content-type': PROBLEM_CONTENT_TYPE }
  if (init.retryAfterSeconds !== undefined) {
    headers['retry-after'] = String(init.retryAfterSeconds)
  }
  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * 把命令分发器的失败信封转换为 problem+json。
 * @param result 失败信封
 * @returns HTTP 响应
 */
export function failureResponse(result: FailureResult): Response {
  return problemResponse({
    code: result.code,
    message: result.message,
    hint: result.hint,
    details: result.details,
    retryable: result.retryable,
    meta: result.meta,
  })
}
