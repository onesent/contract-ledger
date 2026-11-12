/**
 * 安全中间件：Host 白名单、精确 Origin、CSRF 双提交与 Bearer 豁免。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  BASE_URL,
  contractInput,
  createBearer,
  createHttpTestContext,
  pairBrowser,
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

describe('Host 与 Origin 防护', () => {
  it('伪造 Host 返回 403 HOST_REJECTED', async () => {
    const ctx = await setup()
    const response = await ctx.app.request(`${BASE_URL}/api/health`, {
      headers: { host: 'evil.example' },
    })
    expect(response.status).toBe(403)
    const body = await response.json() as { code: string }
    expect(body.code).toBe('HOST_REJECTED')
  })

  it('其他本地端口的 Origin 写请求返回 403 ORIGIN_REJECTED', async () => {
    const ctx = await setup()
    const browser = await pairBrowser(ctx)
    const response = await ctx.app.request(`${BASE_URL}/api/commands/contract.upsert`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: browser.cookie,
        origin: 'http://127.0.0.1:9999',
        'x-csrf-token': browser.csrfToken,
        'idempotency-key': 'origin-cross-port',
      },
      body: JSON.stringify(contractInput({ no: 'HT-ORIGIN-1' })),
    })
    expect(response.status).toBe(403)
    const body = await response.json() as { code: string }
    expect(body.code).toBe('ORIGIN_REJECTED')
  })

  it('Bearer 请求豁免 Origin 校验', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    const response = await ctx.app.request(`${BASE_URL}/api/commands/contract.upsert`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        origin: 'http://evil.example',
        'idempotency-key': 'bearer-origin',
      },
      body: JSON.stringify(contractInput({ no: 'HT-ORIGIN-2' })),
    })
    expect(response.status).toBe(200)
  })
})

describe('CSRF 双提交', () => {
  it('Cookie 写请求缺少 CSRF 头返回 403', async () => {
    const ctx = await setup()
    const browser = await pairBrowser(ctx)
    const response = await ctx.app.request(`${BASE_URL}/api/commands/contract.upsert`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: browser.cookie,
        origin: BASE_URL,
        'idempotency-key': 'cookie-no-csrf',
      },
      body: JSON.stringify(contractInput({ no: 'HT-CSRF-1' })),
    })
    expect(response.status).toBe(403)
    const body = await response.json() as { code: string; detail: string }
    expect(body.code).toBe('ORIGIN_REJECTED')
    expect(body.detail).toContain('CSRF')
  })

  it('Cookie 写请求携带正确 CSRF 头可执行', async () => {
    const ctx = await setup()
    const browser = await pairBrowser(ctx)
    const response = await ctx.app.request(`${BASE_URL}/api/commands/contract.upsert`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: browser.cookie,
        origin: BASE_URL,
        'x-csrf-token': browser.csrfToken,
        'idempotency-key': 'cookie-with-csrf',
      },
      body: JSON.stringify(contractInput({ no: 'HT-CSRF-2' })),
    })
    expect(response.status).toBe(200)
  })
})
