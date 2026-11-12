import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  CSRF_COOKIE,
  CSRF_HEADER,
  command,
  request,
  setUnauthorizedHandler,
  pair,
  listContracts,
} from '../src/api/client'

/**
 * 纯 Node 环境的 API 客户端单测：mock fetch，断言 CSRF 头、错误映射、401 标记与幂等键。
 * 不依赖 jsdom —— 只需最小 document / fetch 桩。
 */

/** @type {{url:string, init:RequestInit}[]} */
let calls = []
/** @type {Response} */
let nextResponse

/**
 * 构造一个 Response 兼容对象。
 * @param {number} status
 * @param {unknown} body
 * @param {string} [contentType]
 */
function jsonResponse(status, body, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body)
    },
    headers: new Headers({ 'content-type': contentType }),
  }
}

beforeEach(() => {
  calls = []
  nextResponse = jsonResponse(200, { ok: true })
  globalThis.document = {
    baseURI: 'http://localhost:5173/',
    cookie: `${CSRF_COOKIE}=csrf-token-abc; other=1`,
  }
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init })
    return nextResponse
  })
})

afterEach(() => {
  setUnauthorizedHandler(null)
  vi.restoreAllMocks()
})

describe('api/client request', () => {
  it('GET 请求带 credentials: include 且不发送 CSRF 头', async () => {
    await request('/api/health')
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe('http://localhost:5173/api/health')
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('GET')
    expect(init.headers[CSRF_HEADER]).toBeUndefined()
  })

  it('非 GET 请求从 ledger_csrf Cookie 注入 X-CSRF-Token', async () => {
    await request('/api/import', { method: 'POST', body: { mode: 'replace' } })
    const { init } = calls[0]
    expect(init.headers[CSRF_HEADER]).toBe('csrf-token-abc')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ mode: 'replace' }))
  })

  it('拼接查询参数并跳过空值', async () => {
    await listContracts({ page: 2, pageSize: 20, direction: 'sale', search: '', status: undefined })
    const { url } = calls[0]
    expect(url).toContain('page=2')
    expect(url).toContain('pageSize=20')
    expect(url).toContain('direction=sale')
    expect(url).not.toContain('search=')
    expect(url).not.toContain('status=')
  })
})

describe('api/client 错误映射', () => {
  it('problem+json 映射为 ApiError（status/code/message/hint/details/retryable）', async () => {
    nextResponse = jsonResponse(
      422,
      {
        type: 'about:blank',
        status: 422,
        detail: '合同编号已存在',
        code: 'DUPLICATE_NO',
        hint: '改用新的编号',
        retryable: false,
        details: { no: 'HT-1' },
        meta: { requestId: 'req-1' },
      },
      'application/problem+json',
    )
    const error = await request('/api/commands/contract.upsert', { method: 'POST', body: {} }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    expect(error.code).toBe('DUPLICATE_NO')
    expect(error.message).toBe('合同编号已存在')
    expect(error.hint).toBe('改用新的编号')
    expect(error.details).toEqual({ no: 'HT-1' })
    expect(error.retryable).toBe(false)
    expect(error.requestId).toBe('req-1')
  })

  it('401 标记 isUnauthorized 并触发未认证回调', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    nextResponse = jsonResponse(401, { code: 'AUTH_REQUIRED', detail: '需要配对' })
    const error = await request('/api/contracts').catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.isUnauthorized).toBe(true)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(onUnauthorized.mock.calls[0][0]).toBeInstanceOf(ApiError)
  })

  it('网络失败映射为 NETWORK_ERROR（status 0，可重试）', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const error = await request('/api/health').catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(0)
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.retryable).toBe(true)
  })
})

describe('api/client command 幂等键', () => {
  it('POST /api/commands/<name> 携带 Idempotency-Key 并返回 data', async () => {
    nextResponse = jsonResponse(200, { ok: true, data: { contract: { id: 'c1' } }, version: 7 })
    const data = await command('contract.upsert', { no: 'HT-1' })
    expect(data).toEqual({ contract: { id: 'c1' } })
    const { url, init } = calls[0]
    expect(url).toBe('http://localhost:5173/api/commands/contract.upsert')
    expect(init.method).toBe('POST')
    expect(init.headers['Idempotency-Key']).toMatch(/[0-9a-f-]{36}|[0-9a-z]+-[0-9a-z]+/)
    expect(init.headers[CSRF_HEADER]).toBe('csrf-token-abc')
    expect(init.body).toBe(JSON.stringify({ no: 'HT-1' }))
  })

  it('两次命令调用使用不同的幂等键', async () => {
    nextResponse = jsonResponse(200, { ok: true, data: {} })
    await command('payment.record', { contractId: 'c1' })
    await command('payment.record', { contractId: 'c1' })
    const key1 = calls[0].init.headers['Idempotency-Key']
    const key2 = calls[1].init.headers['Idempotency-Key']
    expect(key1).not.toBe(key2)
  })
})

describe('api/client pair', () => {
  it('配对走 POST /api/auth/pair（公开端点，仍带 CSRF 头无害）', async () => {
    nextResponse = jsonResponse(200, { ok: true, actor: 'browser' })
    await pair('CODE123')
    const { url, init } = calls[0]
    expect(url).toBe('http://localhost:5173/api/auth/pair')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ code: 'CODE123' }))
  })
})
