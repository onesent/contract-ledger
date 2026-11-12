/**
 * HTTP 层小工具：时间、定长比较、请求体解析、If-Match 解析与限流键。
 * 仅包含无业务含义的纯函数，领域规则仍留在 core。
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import type { AppEnv } from '../types.js'
import { problemResponse } from './problem.js'

/**
 * 读取注入时钟；缺省使用系统时间。
 * @param now 可选时钟
 * @returns 毫秒时间戳
 */
export function nowMs(now?: () => number): number {
  return now === undefined ? Date.now() : now()
}

/**
 * 当前 UTC 业务日期（YYYY-MM-DD）。
 * @param now 毫秒时间戳
 * @returns 业务日期
 */
export function todayIso(nowMsValue: number): string {
  return new Date(nowMsValue).toISOString().slice(0, 10)
}

/**
 * 定长时间比较两个字符串：先摘要再比较，长度差异不会提前返回。
 * @param a 字符串 A
 * @param b 字符串 B
 * @returns 是否相等
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest()
  const right = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(left, right)
}

/** 不安全的写方法集合。 */
const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 是否为需要 CSRF / Origin 校验的写方法。
 * @param method HTTP 方法
 * @returns 是否不安全
 */
export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase())
}

/** JSON 请求体读取成功。 */
export interface JsonReadOk {
  ok: true
  value: unknown
}

/** JSON 请求体读取失败（已构造可直接返回的响应）。 */
export interface JsonReadFail {
  ok: false
  response: Response
}

/**
 * 读取并解析 JSON 请求体；解析失败返回 problem+json。
 * @param c Hono 上下文
 * @returns 解析结果或错误响应
 */
export async function readJson(c: Context<AppEnv>): Promise<JsonReadOk | JsonReadFail> {
  try {
    const value: unknown = await c.req.json()
    return { ok: true, value }
  } catch {
    /* 请求体为空或不是合法 JSON，统一按校验失败处理 */
    return {
      ok: false,
      response: problemResponse({
        code: 'VALIDATION_FAILED',
        message: '请求体不是合法 JSON 对象。',
      }),
    }
  }
}

/**
 * 是否为普通对象。
 * @param value 任意值
 * @returns 是否为 Record
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** If-Match 解析成功。 */
export interface IfMatchOk {
  ok: true
  version?: number
}

/** If-Match 解析失败。 */
export interface IfMatchFail {
  ok: false
}

/**
 * 解析 `If-Match: "v<n>"`（允许弱校验前缀 W/）。
 * @param raw 头部原始值
 * @returns 期望版本或解析失败
 */
export function parseIfMatch(raw: string | undefined): IfMatchOk | IfMatchFail {
  if (raw === undefined) return { ok: true }
  const value = raw.trim()
  if (value === '') return { ok: true }
  const match = /^(?:W\/)?"v(\d+)"$/.exec(value)
  if (match === null) return { ok: false }
  const version = Number(match[1])
  if (!Number.isSafeInteger(version) || version < 0) return { ok: false }
  return { ok: true, version }
}

/**
 * 从请求对象中读取对端地址；拿不到时回落为 local。
 * 仅接受 Node 适配器提供的 socket 信息，不信任任何 X-Forwarded-* 头。
 * @param env Hono 运行时环境
 * @returns 限流键
 */
export function clientKey(env: unknown): string {
  if (typeof env !== 'object' || env === null) return 'local'
  if (!('incoming' in env)) return 'local'
  const incoming = env.incoming
  if (typeof incoming !== 'object' || incoming === null) return 'local'
  if (!('socket' in incoming)) return 'local'
  const socket = incoming.socket
  if (typeof socket !== 'object' || socket === null) return 'local'
  if (!('remoteAddress' in socket)) return 'local'
  return typeof socket.remoteAddress === 'string' ? socket.remoteAddress : 'local'
}

/**
 * 解析查询参数中的正整数；非法值返回 undefined。
 * @param raw 原始字符串
 * @returns 正整数或 undefined
 */
export function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) return undefined
  return value
}

/**
 * 解析查询参数中的非负整数；非法值返回 undefined。
 * @param raw 原始字符串
 * @returns 非负整数或 undefined
 */
export function parseNonNegativeInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) return undefined
  return value
}
