/**
 * Hono HTTP 服务装配：健康检查、安全中间件链与路由注册。
 *
 * 中间件顺序（design.md 认证设计）：
 * Host 白名单 → Cookie 写请求精确 Origin → 认证（Bearer 或会话 Cookie）
 * → Cookie 写请求 CSRF 双提交 → 限流 → 业务路由。
 */
import { Hono } from 'hono'
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
 * 创建 Hono 应用。
 * @param options 存储、认证与安全配置
 * @returns 已注册全部路由的应用实例
 */
export function createApp(options: AppOptions): LedgerApp {
  const app = new Hono<AppEnv>()
  const guards = createSecurityGuards(options)

  app.use('*', guards.hostGuard)
  app.use('/api/*', guards.originGuard)
  app.use('/api/*', guards.credentialGuard)
  app.use('/api/*', guards.csrfGuard)
  app.use('/api/*', guards.rateLimitGuard)

  app.get('/api/health', (c) =>
    c.json({ ok: true, version: SERVER_VERSION, schemaVersion: '1' }),
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
