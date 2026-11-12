/**
 * 命令端点：把 HTTP 请求映射为统一的 dispatch 调用。
 * 映射规则：Idempotency-Key → 幂等键；If-Match `"v<n>"` → expectedVersion；
 * 失败结果 → application/problem+json。
 */
import { dispatch } from '@ledger/core'
import { failureResponse, problemResponse } from '../http/problem.js'
import { parseIfMatch, readJson } from '../http/util.js'
import type { AppOptions, LedgerApp } from '../types.js'

/**
 * 注册命令路由。
 * @param app Hono 应用
 * @param options 应用配置
 */
export function registerCommandRoutes(app: LedgerApp, options: AppOptions): void {
  app.post('/api/commands/:name', async (c) => {
    const name = c.req.param('name')
    const command = options.registry.get(name)
    if (command !== null && !command.annotations.readOnlyHint) {
      if (options.readonly === true) {
        return problemResponse({
          code: 'READONLY',
          message: '当前服务处于只读模式，写命令被拒绝。',
        })
      }
      const idempotencyKey = c.req.header('Idempotency-Key')
      if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
        return problemResponse({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '写命令必须携带 Idempotency-Key 请求头。',
        })
      }
    }

    const ifMatch = parseIfMatch(c.req.header('If-Match'))
    if (!ifMatch.ok) {
      return problemResponse({
        code: 'VALIDATION_FAILED',
        message: 'If-Match 头格式非法，应为 "v<版本号>"。',
        details: { header: c.req.header('If-Match') ?? null },
      })
    }

    const parsed = await readJson(c)
    if (!parsed.ok) return parsed.response

    const result = await dispatch(options.registry, name, parsed.value, {
      store: options.store,
      actor: c.get('actor'),
      transport: 'http',
      idempotencyKey: c.req.header('Idempotency-Key'),
      expectedVersion: ifMatch.version,
    })

    if (!result.ok) {
      // 存储层报告只读时立即切换服务状态，后续写请求在路由层被快速拒绝。
      if (result.code === 'READONLY') options.readonly = true
      return failureResponse(result)
    }
    c.header('ETag', `"v${result.version}"`)
    return c.json(result, 200)
  })
}
