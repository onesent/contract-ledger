/**
 * Hono HTTP 服务装配：健康检查、安全中间件链与路由注册。
 *
 * 中间件顺序（design.md 认证设计）：
 * Host 白名单 → Cookie 写请求精确 Origin → 限流
 * → 认证（Bearer 或会话 Cookie）→ Cookie 写请求 CSRF 双提交 → 业务路由。
 * 限流必须早于认证：否则未认证的暴力尝试在限流计数前就被 401 短路。
 */
import { Hono } from 'hono'
import type { Database } from '@ledger/storage-sqlite'
import { createSecurityGuards } from './http/guards.js'
import { createMeta, problemResponse } from './http/problem.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCommandRoutes } from './routes/commands.js'
import { registerDatasetRoutes } from './routes/dataset.js'
import { registerReadRoutes } from './routes/read.js'
import type { AppEnv, AppOptions, LedgerApp } from './types.js'

/** 健康端点返回的服务版本。 */
export const SERVER_VERSION = '0.0.0'

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
 * 创建 Hono 应用。
 * @param options 存储、认证与安全配置
 * @returns 已注册全部路由的应用实例
 */
export function createApp(options: AppOptions): LedgerApp {
  const app = new Hono<AppEnv>()
  const guards = createSecurityGuards(options)

  // 基线安全响应头：API 只返回 JSON，使用最严格的 CSP；反向代理或静态站点需另行放开。
  app.use('*', async (c, next) => {
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
    c.header('Cache-Control', 'no-store')
  })

  app.use('*', guards.hostGuard)
  app.use('/api/*', guards.originGuard)
  app.use('/api/*', guards.rateLimitGuard)
  app.use('/api/*', guards.credentialGuard)
  app.use('/api/*', guards.csrfGuard)

  // 健康端点不含业务数据：版本、API 信封版本、主库大小与可写状态。
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      version: SERVER_VERSION,
      schemaVersion: '1',
      databaseBytes: databaseBytes(options.db),
      writable: options.readonly !== true,
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
