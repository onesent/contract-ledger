/**
 * 认证路由：配对、会话读取、登出、agent 令牌与浏览器会话管理。
 * 所有响应遵循统一 JSON 信封；错误走 problem+json。
 */
import { setCookie, deleteCookie } from 'hono/cookie'
import {
  createAgentToken,
  createSession,
  generateSecret,
  listAgentTokens,
  listSessions,
  revokeAgentToken,
  revokeAllSessions,
  revokeSession,
} from '../auth/tokens.js'
import { CSRF_COOKIE, SESSION_COOKIE } from '../http/cookies.js'
import { problemResponse } from '../http/problem.js'
import { isRecord, nowMs, readJson } from '../http/util.js'
import type { AppOptions, LedgerApp } from '../types.js'

/** 浏览器会话操作者标识。 */
const BROWSER_ACTOR = 'browser'

/**
 * 读取可选的字符串字段。
 * @param value 原始值
 * @param field 字段名（用于错误消息）
 * @returns 字段值；未提供返回 undefined
 */
function optionalString(
  value: unknown,
  field: string,
): { ok: true; value: string | undefined } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value !== 'string') return { ok: false, message: `字段 ${field} 必须是字符串。` }
  return { ok: true, value }
}

/**
 * 注册认证相关路由。
 * @param app Hono 应用
 * @param options 应用配置
 */
export function registerAuthRoutes(app: LedgerApp, options: AppOptions): void {
  const currentDate = (): Date => new Date(nowMs(options.now))

  app.post('/api/auth/pair', async (c) => {
    const parsed = await readJson(c)
    if (!parsed.ok) return parsed.response
    if (!isRecord(parsed.value) || typeof parsed.value.code !== 'string') {
      return problemResponse({
        code: 'VALIDATION_FAILED',
        message: '配对请求必须包含字符串字段 code。',
      })
    }
    const verified = options.pairing.verify(parsed.value.code)
    if (!verified.ok) {
      const message = verified.code === 'RATE_LIMITED'
        ? '配对尝试次数过多，请回到启动终端获取新的配对码。'
        : '配对码无效、已过期或已使用。'
      return problemResponse({
        code: verified.code,
        message,
        details: { attemptsLeft: verified.attemptsLeft },
        retryAfterSeconds: verified.code === 'RATE_LIMITED' ? 60 : undefined,
      })
    }
    const userAgent = c.req.header('user-agent') ?? ''
    const session = createSession(options.db, {
      actor: BROWSER_ACTOR,
      userAgent,
      now: currentDate(),
    })
    const csrfToken = generateSecret(32)
    setCookie(c, SESSION_COOKIE, `${session.id}.${session.secret}`, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
    })
    setCookie(c, CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      sameSite: 'Strict',
      path: '/',
    })
    return c.json({
      ok: true,
      actor: BROWSER_ACTOR,
      csrfToken,
      expiresAt: session.expiresAt,
    })
  })

  app.get('/api/auth/session', (c) => {
    const sessionId = c.get('sessionId')
    if (sessionId === null) {
      return c.json({ ok: true, actor: c.get('actor'), expiresAt: null })
    }
    const session = listSessions(options.db).find((item) => item.id === sessionId)
    if (session === undefined) {
      return problemResponse({
        code: 'AUTH_INVALID',
        message: '会话不存在或已失效。',
      })
    }
    return c.json({ ok: true, actor: session.actor, expiresAt: session.expiresAt })
  })

  app.post('/api/auth/logout', (c) => {
    const sessionId = c.get('sessionId')
    if (sessionId !== null) {
      revokeSession(options.db, sessionId, currentDate())
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    deleteCookie(c, CSRF_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/auth/tokens', (c) => {
    const actor = c.req.query('actor')
    const items = actor === undefined ? listAgentTokens(options.db) : listAgentTokens(options.db, actor)
    return c.json({ ok: true, items })
  })

  app.post('/api/auth/tokens', async (c) => {
    const parsed = await readJson(c)
    if (!parsed.ok) return parsed.response
    if (!isRecord(parsed.value)) {
      return problemResponse({
        code: 'VALIDATION_FAILED',
        message: '创建令牌请求体必须是 JSON 对象。',
      })
    }
    const label = optionalString(parsed.value.label, 'label')
    if (!label.ok) return problemResponse({ code: 'VALIDATION_FAILED', message: label.message })
    const actor = optionalString(parsed.value.actor, 'actor')
    if (!actor.ok) return problemResponse({ code: 'VALIDATION_FAILED', message: actor.message })
    const expiresAt = optionalString(parsed.value.expiresAt, 'expiresAt')
    if (!expiresAt.ok) {
      return problemResponse({ code: 'VALIDATION_FAILED', message: expiresAt.message })
    }
    const tokenActor = actor.value ?? (label.value !== undefined && label.value !== '' ? label.value : c.get('actor'))
    const created = createAgentToken(options.db, {
      actor: tokenActor,
      label: label.value,
      expiresAt: expiresAt.value,
      now: currentDate(),
    })
    return c.json({
      ok: true,
      token: created.token,
      id: created.id,
      actor: tokenActor,
      label: label.value ?? '',
      expiresAt: created.expiresAt,
    })
  })

  app.delete('/api/auth/tokens/:id', (c) => {
    const id = c.req.param('id')
    if (id === undefined || id === '') {
      return problemResponse({ code: 'VALIDATION_FAILED', message: '缺少令牌 id。' })
    }
    const revoked = revokeAgentToken(options.db, id, currentDate())
    if (!revoked) {
      return problemResponse({ code: 'NOT_FOUND', message: `令牌不存在或已吊销：${id}` })
    }
    return c.json({ ok: true, id, revoked: true })
  })

  app.post('/api/auth/tokens/:id/rotate', (c) => {
    const id = c.req.param('id')
    if (id === undefined || id === '') {
      return problemResponse({ code: 'VALIDATION_FAILED', message: '缺少令牌 id。' })
    }
    const existing = listAgentTokens(options.db).find((item) => item.id === id)
    if (existing === undefined) {
      return problemResponse({ code: 'NOT_FOUND', message: `令牌不存在：${id}` })
    }
    revokeAgentToken(options.db, id, currentDate())
    const created = createAgentToken(options.db, {
      actor: existing.actor,
      label: existing.label,
      now: currentDate(),
    })
    return c.json({
      ok: true,
      token: created.token,
      id: created.id,
      previousId: id,
      actor: existing.actor,
      label: existing.label,
      expiresAt: created.expiresAt,
    })
  })

  app.get('/api/auth/sessions', (c) => {
    const actor = c.req.query('actor')
    const items = actor === undefined ? listSessions(options.db) : listSessions(options.db, actor)
    return c.json({ ok: true, items })
  })

  app.delete('/api/auth/sessions/:id', (c) => {
    const id = c.req.param('id')
    if (id === undefined || id === '') {
      return problemResponse({ code: 'VALIDATION_FAILED', message: '缺少会话 id。' })
    }
    const revoked = revokeSession(options.db, id, currentDate())
    if (!revoked) {
      return problemResponse({ code: 'NOT_FOUND', message: `会话不存在或已吊销：${id}` })
    }
    return c.json({ ok: true, id, revoked: true })
  })

  app.post('/api/auth/sessions/revoke-all', (c) => {
    const actor = c.get('actor')
    const revoked = revokeAllSessions(options.db, actor, currentDate())
    return c.json({ ok: true, actor, revoked })
  })
}
