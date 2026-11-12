/**
 * 认证路由：配对、会话、登出、令牌签发/轮换/吊销与会话批量吊销。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  BASE_URL,
  createHttpTestContext,
  pairBrowser,
  readSetCookies,
  type HttpTestContext,
} from './http-helpers.js'

/** 当前测试上下文。 */
let context: HttpTestContext | null = null

afterEach(() => {
  context?.dispose()
  context = null
})

/**
 * 创建上下文并登记清理。
 * @returns 测试上下文
 */
async function setup(): Promise<HttpTestContext> {
  context = await createHttpTestContext()
  return context
}

/**
 * 给 Cookie 请求补充 Origin 与 CSRF 头。
 * @param cookie 会话 Cookie
 * @param csrfToken CSRF 令牌
 * @returns 请求头
 */
function writeHeaders(cookie: string, csrfToken: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    cookie,
    origin: BASE_URL,
    'x-csrf-token': csrfToken,
  }
}

describe('配对与会话', () => {
  it('有效配对码签发 Cookie 并返回 csrfToken', async () => {
    const ctx = await setup()
    const issued = ctx.pairing.issue()
    const response = await ctx.app.request(`${BASE_URL}/api/auth/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issued.code }),
    })
    expect(response.status).toBe(200)
    const cookies = readSetCookies(response)
    expect(cookies.has('ledger_sid')).toBe(true)
    expect(cookies.has('ledger_csrf')).toBe(true)
    const body = await response.json() as {
      ok: boolean
      actor: string
      csrfToken: string
      expiresAt: string
    }
    expect(body.ok).toBe(true)
    expect(body.actor).toBe('browser')
    expect(body.csrfToken.length).toBeGreaterThan(20)
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('已使用的配对码再次提交返回 401 PAIR_CODE_INVALID', async () => {
    const ctx = await setup()
    const issued = ctx.pairing.issue()
    const first = await ctx.app.request(`${BASE_URL}/api/auth/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issued.code }),
    })
    expect(first.status).toBe(200)
    const second = await ctx.app.request(`${BASE_URL}/api/auth/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issued.code }),
    })
    expect(second.status).toBe(401)
    const body = await second.json() as { code: string }
    expect(body.code).toBe('PAIR_CODE_INVALID')
  })

  it('GET /api/auth/session 返回当前主体与过期时间', async () => {
    const ctx = await setup()
    const browser = await pairBrowser(ctx)
    const response = await ctx.app.request(`${BASE_URL}/api/auth/session`, {
      headers: { cookie: browser.cookie },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { ok: boolean; actor: string; expiresAt: string }
    expect(body.actor).toBe('browser')
    expect(typeof body.expiresAt).toBe('string')
  })

  it('登出后会话立即失效', async () => {
    const ctx = await setup()
    const browser = await pairBrowser(ctx)
    const logout = await ctx.app.request(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: writeHeaders(browser.cookie, browser.csrfToken),
    })
    expect(logout.status).toBe(200)
    const session = await ctx.app.request(`${BASE_URL}/api/auth/session`, {
      headers: { cookie: browser.cookie },
    })
    expect(session.status).toBe(401)
  })
})

describe('agent 令牌与会话管理', () => {
  it('创建、列出、轮换并吊销令牌', async () => {
    const ctx = await setup()
    const browser = await pairBrowser(ctx)
    const created = await ctx.app.request(`${BASE_URL}/api/auth/tokens`, {
      method: 'POST',
      headers: writeHeaders(browser.cookie, browser.csrfToken),
      body: JSON.stringify({ label: 'cli' }),
    })
    expect(created.status).toBe(200)
    const createdBody = await created.json() as { token: string; id: string }
    expect(createdBody.token.startsWith('ldg_')).toBe(true)

    const listed = await ctx.app.request(`${BASE_URL}/api/auth/tokens`, {
      headers: { cookie: browser.cookie },
    })
    const listedBody = await listed.json() as { items: Array<{ id: string; label: string }> }
    expect(listedBody.items).toHaveLength(1)
    expect(listedBody.items[0]?.label).toBe('cli')

    const rotated = await ctx.app.request(`${BASE_URL}/api/auth/tokens/${createdBody.id}/rotate`, {
      method: 'POST',
      headers: writeHeaders(browser.cookie, browser.csrfToken),
    })
    expect(rotated.status).toBe(200)
    const rotatedBody = await rotated.json() as { token: string; id: string; previousId: string }
    expect(rotatedBody.token.startsWith('ldg_')).toBe(true)
    expect(rotatedBody.previousId).toBe(createdBody.id)
    expect(rotatedBody.id).not.toBe(createdBody.id)

    const oldToken = await ctx.app.request(`${BASE_URL}/api/auth/sessions`, {
      headers: { authorization: `Bearer ${createdBody.token}` },
    })
    expect(oldToken.status).toBe(401)
    const newToken = await ctx.app.request(`${BASE_URL}/api/auth/sessions`, {
      headers: { authorization: `Bearer ${rotatedBody.token}` },
    })
    expect(newToken.status).toBe(200)

    const revoked = await ctx.app.request(`${BASE_URL}/api/auth/tokens/${rotatedBody.id}`, {
      method: 'DELETE',
      headers: writeHeaders(browser.cookie, browser.csrfToken),
    })
    expect(revoked.status).toBe(200)
  })

  it('配对接口超过窗口上限返回 429 并带 Retry-After', async () => {
    const ctx = await setup()
    ctx.pairing.issue()
    const statuses: number[] = []
    let last: Response | null = null
    for (let index = 0; index < 6; index += 1) {
      last = await ctx.app.request(`${BASE_URL}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: '00000000' }),
      })
      statuses.push(last.status)
    }
    expect(statuses[5]).toBe(429)
    expect(last?.headers.get('retry-after')).not.toBeNull()
  })

  it('会话列表可读且 revoke-all 吊销当前主体全部会话', async () => {
    const ctx = await setup()
    const browser = await pairBrowser(ctx)
    const listed = await ctx.app.request(`${BASE_URL}/api/auth/sessions`, {
      headers: { cookie: browser.cookie },
    })
    const listedBody = await listed.json() as { items: Array<{ id: string }> }
    expect(listedBody.items.length).toBeGreaterThanOrEqual(1)

    const revoked = await ctx.app.request(`${BASE_URL}/api/auth/sessions/revoke-all`, {
      method: 'POST',
      headers: writeHeaders(browser.cookie, browser.csrfToken),
    })
    expect(revoked.status).toBe(200)
    const body = await revoked.json() as { revoked: number }
    expect(body.revoked).toBeGreaterThanOrEqual(1)

    const session = await ctx.app.request(`${BASE_URL}/api/auth/session`, {
      headers: { cookie: browser.cookie },
    })
    expect(session.status).toBe(401)
  })
})
