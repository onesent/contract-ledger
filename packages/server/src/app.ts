/**
 * Hono HTTP 服务装配：健康检查、安全中间件链与路由注册。
 *
 * 中间件顺序（design.md 认证设计）：
 * Host 白名单 → Cookie 写请求精确 Origin → 限流
 * → 认证（Bearer 或会话 Cookie）→ Cookie 写请求 CSRF 双提交 → 业务路由。
 * 限流必须早于认证：否则未认证的暴力尝试在限流计数前就被 401 短路。
 */
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import path from 'node:path'
import type { Database } from '@ledger/storage-sqlite'
import { resolveBuildInfo } from './build-info.js'
import { SERVER_VERSION } from './version.js'
import { createSecurityGuards } from './http/guards.js'
import { listSessions } from './auth/tokens.js'
import { createMeta, problemResponse } from './http/problem.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCommandRoutes } from './routes/commands.js'
import { registerDatasetRoutes } from './routes/dataset.js'
import { registerReadRoutes } from './routes/read.js'
import type { AppEnv, AppOptions, LedgerApp } from './types.js'

/** 健康端点返回的服务版本（未注入时使用常量）。 */
export { SERVER_VERSION } from './version.js'

/** API 响应头：只返回 JSON，使用最严格的 CSP。 */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

/**
 * 页面响应头：只许可同源资源。
 * style-src 需要 'unsafe-inline'（Element Plus 运行时注入样式），img-src 需要 data:（内联 favicon）。
 */
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
  "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

/**
 * 判断是否为 API 路径。
 * @param pathname 请求路径
 * @returns 是 API 路径返回 true
 */
function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * 运行期切换只读模式；路由在每次请求时读取最新值。
 * @param options 应用配置（createApp 时传入的同一对象）
 * @param readonly 是否只读
 */
export function setReadonly(options: AppOptions, readonly: boolean): void {
  options.readonly = readonly
}

/**
 * 主库占用字节数：page_count × page_size；读取失败返回 null，不影响存活探测。
 * @param db 数据库连接
 * @returns 字节数或 null
 */
function databaseBytes(db: Database): number | null {
  try {
    const pageCount = Number(db.pragma('page_count', { simple: true }))
    const pageSize = Number(db.pragma('page_size', { simple: true }))
    if (!Number.isFinite(pageCount) || !Number.isFinite(pageSize)) return null
    return pageCount * pageSize
  } catch {
    return null
  }
}

/**
 * 是否存在有效浏览器会话（启动器据此判断是否需要展示配对码）。
 * @param db 数据库连接
 * @param now 当前时间（毫秒）
 * @returns 存在未吐销且未过期的会话返回 true
 */
function hasActiveSession(db: Database, now: number): boolean {
  try {
    return listSessions(db).some(
      (session) => session.revokedAt === null && Date.parse(session.expiresAt) > now,
    )
  } catch {
    return false
  }
}

/**
 * 创建 Hono 应用。
 * @param options 存储、认证与安全配置
 * @returns 已注册全部路由的应用实例
 */
export function createApp(options: AppOptions): LedgerApp {
  const app = new Hono<AppEnv>()
  const guards = createSecurityGuards(options)
  // 版本在创建时解析一次：显式传入 > 构建信息（载荷 build-info.json）> 根 package.json > 常量。
  const serverVersion = options.version ?? resolveBuildInfo().version

  // 响应头按路径分层：API 只返回 JSON（最严 CSP、不缓存），页面返回同源静态资源。
  app.use('*', async (c, next) => {
    await next()
    const api = isApiPath(c.req.path)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Content-Security-Policy', api ? API_CSP : PAGE_CSP)
    c.header('Cache-Control', api ? 'no-store' : 'no-cache')
  })

  app.use('*', guards.hostGuard)

  // 同源托管前端构建产物：/api/* 走认证链，其余路径先找静态文件，无扩展名时回落 index.html。
  const webDir = options.webDir
  if (webDir !== undefined) {
    const serveAssets = serveStatic<AppEnv>({ root: webDir })
    const serveIndex = serveStatic<AppEnv>({ root: webDir, path: 'index.html' })
    app.use('*', async (c, next) => {
      if (isApiPath(c.req.path)) return next()
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
      const asset = await serveAssets(c, async () => {})
      if (asset !== undefined) return asset
      if (path.extname(c.req.path) !== '') return next()
      const index = await serveIndex(c, async () => {})
      if (index !== undefined) return index
      return next()
    })
  }
  app.use('/api/*', guards.originGuard)
  app.use('/api/*', guards.rateLimitGuard)
  app.use('/api/*', guards.credentialGuard)
  app.use('/api/*', guards.csrfGuard)

  // 健康端点不含业务数据：版本、信封版本、主库大小、可写状态与是否已配对。
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      version: serverVersion,
      schemaVersion: '1',
      databaseBytes: databaseBytes(options.db),
      writable: options.readonly !== true,
      paired: hasActiveSession(options.db, (options.now ?? Date.now)()),
    }),
  )

  registerAuthRoutes(app, options)
  registerReadRoutes(app, options)
  registerCommandRoutes(app, options)
  registerDatasetRoutes(app, options)

  app.notFound((c) =>
    problemResponse({
      code: 'NOT_FOUND',
      message: `接口不存在：${c.req.method} ${c.req.path}`,
      meta: createMeta(c.get('actor') || 'anonymous'),
    }),
  )

  app.onError((error, c) => {
    const message = error instanceof Error && error.message !== ''
      ? `服务内部错误：${error.message}`
      : '服务内部错误。'
    return problemResponse({
      code: 'INTERNAL',
      message,
      meta: createMeta(c.get('actor') || 'anonymous'),
    })
  })

  return app
}
