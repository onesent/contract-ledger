/**
 * 安全中间件工厂：Host / Origin / 认证 / CSRF / 限流。
 * 顺序由 app.ts 负责编排：Host → Origin → 认证 → CSRF → 限流 → 业务。
 */
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyAgentToken, verifySession } from '../auth/tokens.js'
import type { AppEnv, AppOptions } from '../types.js'
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './cookies.js'
import { createMeta, problemResponse } from './problem.js'
import { AUTH_RATE_RULE, PAIR_RATE_RULE, RateLimiter } from './rate-limit.js'
import { clientKey, constantTimeEqual, isUnsafeMethod, nowMs } from './util.js'

/** 无需认证的路径。 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/api/health', '/api/auth/pair'])

/** 配对限流的来源键后缀。 */
const PAIR_ROUTE_KEY = 'pair'

/** 一般认证限流的来源键后缀。 */
const AUTH_ROUTE_KEY = 'auth'

/** 一套安全中间件。 */
export interface SecurityGuards {
  hostGuard: MiddlewareHandler<AppEnv>
  originGuard: MiddlewareHandler<AppEnv>
  credentialGuard: MiddlewareHandler<AppEnv>
  csrfGuard: MiddlewareHandler<AppEnv>
  rateLimitGuard: MiddlewareHandler<AppEnv>
}

/**
 * 解析 URL 后取 host；非法值返回 null。
 * @param origin Origin 字符串
 * @returns host:port 或 null
 */
function parseOriginHost(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    /* 非法 Origin 不进入白名单 */
    return null
  }
}

/**
 * 去除末尾斜杠，保留其余精确内容。
 * @param origin Origin 字符串
 * @returns 规范化后的 Origin
 */
function normalizeOrigin(origin: string): string {
  return origin.endsWith('/') ? origin.slice(0, -1) : origin
}

/**
 * 读取请求 Host；Node Fetch Request 不暴露 Host 头时回落到 URL 的 host。
 * @param url 请求 URL
 * @param header Host 头
 * @returns host:port 或 undefined
 */
function resolveRequestHost(url: string, header: string | undefined): string | undefined {
  if (header !== undefined && header !== '') return header
  try {
    return new URL(url).host
  } catch {
    /* URL 一定由运行时提供；解析失败按缺失 Host 处理 */
    return undefined
  }
}

/**
 * 构造 Host 与 Origin 白名单。
 * @param options 应用配置
 * @returns Host 集合与 Origin 集合
 */
export function buildAllowlists(options: AppOptions): { hosts: Set<string>; origins: Set<string> } {
  const port = options.port ?? 4517
  const hosts = new Set<string>([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ])
  const origins = new Set<string>([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ])
  const configuredHost = options.host
  if (configuredHost !== undefined && configuredHost !== '') {
    const hostEntry = configuredHost === '::1' ? `[::1]:${port}` : `${configuredHost}:${port}`
    hosts.add(hostEntry)
    origins.add(`http://${hostEntry}`)
  }
  for (const origin of options.allowedOrigins ?? []) {
    const trimmed = origin.trim()
    if (trimmed === '') continue
    origins.add(normalizeOrigin(trimmed))
    const host = parseOriginHost(trimmed)
    if (host !== null) hosts.add(host)
  }
  return { hosts, origins }
}

/**
 * 创建安全中间件集合。
 * @param options 应用配置
 * @returns 按顺序可注册的中间件
 */
export function createSecurityGuards(options: AppOptions): SecurityGuards {
  const { hosts, origins } = buildAllowlists(options)
  const clock = (): number => nowMs(options.now)
  const limiter = new RateLimiter(clock)

  const hostGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
    const host = resolveRequestHost(c.req.url, c.req.header('host'))
    if (host === undefined || !hosts.has(host)) {
      return problemResponse({
        code: 'HOST_REJECTED',
        message: `请求 Host 不在白名单：${host ?? '(缺失)'}`,
        details: { host: host ?? null },
      })
    }
    await next()
    return
  }

  const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!isUnsafeMethod(c.req.method)) {
      await next()
      return
    }
    const hasAuthorization = c.req.header('authorization') !== undefined
    const hasSessionCookie = getCookie(c, SESSION_COOKIE) !== undefined
    // Bearer 不携带环境凭证，免 Origin 校验；没有会话 Cookie 的请求也无环境凭证。
    if (hasAuthorization || !hasSessionCookie) {
      await next()
      return
    }
    const origin = c.req.header('origin')
    if (origin === undefined || !origins.has(normalizeOrigin(origin))) {
      return problemResponse({
        code: 'ORIGIN_REJECTED',
        message: '请求 Origin 不被信任，写操作未执行。',
        details: { origin: origin ?? null },
      })
    }
    await next()
    return
  }

  const credentialGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) {
      await next()
      return
    }
    const authHeader = c.req.header('authorization')
    if (authHeader !== undefined) {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
      const token = match?.[1] ?? ''
      const result = verifyAgentToken(options.db, token, { now: new Date(clock()) })
      if (!result.ok) {
        return problemResponse({
          code: result.code,
          message: result.code === 'AUTH_REQUIRED'
            ? '缺少 Bearer 令牌。'
            : 'Bearer 令牌无效或已吊销。',
        })
      }
      c.set('actor', result.actor)
      c.set('authType', 'bearer')
      c.set('sessionId', null)
      await next()
      return
    }

    const raw = getCookie(c, SESSION_COOKIE)
    if (raw === undefined || raw === '') {
      return problemResponse({
        code: 'AUTH_REQUIRED',
        message: '请求缺少认证凭证，请先完成配对或使用 Bearer 令牌。',
      })
    }
    const separator = raw.indexOf('.')
    const id = separator > 0 ? raw.slice(0, separator) : ''
    const secret = separator > 0 ? raw.slice(separator + 1) : ''
    const result = verifySession(options.db, { id, secret }, { now: new Date(clock()) })
    if (!result.ok) {
      return problemResponse({
        code: result.code,
        message: '会话无效、已吊销或已过期，请重新配对。',
      })
    }
    c.set('actor', result.actor)
    c.set('authType', 'cookie')
    c.set('sessionId', id)
    await next()
    return
  }

  const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.get('authType') !== 'cookie' || !isUnsafeMethod(c.req.method)) {
      await next()
      return
    }
    const header = c.req.header(CSRF_HEADER)
    const cookie = getCookie(c, CSRF_COOKIE)
    if (header === undefined || cookie === undefined || !constantTimeEqual(header, cookie)) {
      return problemResponse({
        code: 'ORIGIN_REJECTED',
        message: 'Cookie 写请求缺少有效的 CSRF 令牌。',
        hint: '从配对响应读取 ledger_csrf Cookie，并把相同值放入 X-CSRF-Token 请求头后重试。',
      })
    }
    await next()
    return
  }

  const rateLimitGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.req.path === '/api/health') {
      await next()
      return
    }
    const isPair = c.req.path === '/api/auth/pair'
    const rule = isPair ? PAIR_RATE_RULE : AUTH_RATE_RULE
    const key = `${clientKey(c.env)}:${isPair ? PAIR_ROUTE_KEY : AUTH_ROUTE_KEY}`
    const result = limiter.check(key, rule)
    if (!result.allowed) {
      return problemResponse({
        code: 'RATE_LIMITED',
        message: '请求过于频繁，已暂时拒绝。',
        meta: createMeta(c.get('actor') || 'anonymous'),
        retryAfterSeconds: result.retryAfterSeconds,
      })
    }
    await next()
    return
  }

  return { hostGuard, originGuard, credentialGuard, csrfGuard, rateLimitGuard }
}
