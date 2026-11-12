/**
 * 命令端点：成功信封、幂等重放、If-Match 版本冲突、校验失败与未知命令。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  BASE_URL,
  contractInput,
  createBearer,
  createHttpTestContext,
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
 * 发送合同 upsert 命令。
 * @param ctx 测试上下文
 * @param token Bearer 令牌
 * @param body 合同入参
 * @param headers 额外请求头
 * @returns HTTP 响应
 */
async function postContract(
  ctx: HttpTestContext,
  token: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  return ctx.app.request(`${BASE_URL}/api/commands/contract.upsert`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('命令成功与 ETag', () => {
  it('写命令成功返回 200、CommandResult 与新版本 ETag', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    const response = await postContract(
      ctx,
      token,
      contractInput({ no: 'HT-CMD-1' }),
      { 'idempotency-key': 'cmd-success-1' },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"v1"')
    const body = await response.json() as {
      ok: boolean
      version: number
      data: { contract: { no: string } }
    }
    expect(body.ok).toBe(true)
    expect(body.version).toBe(1)
    expect(body.data.contract.no).toBe('HT-CMD-1')
  })

  it('写命令缺少 Idempotency-Key 返回 400', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    const response = await postContract(ctx, token, contractInput({ no: 'HT-CMD-2' }), {})
    expect(response.status).toBe(400)
    const body = await response.json() as { code: string }
    expect(body.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })
})

describe('幂等与并发', () => {
  it('相同幂等键重放不产生重复记录', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    const body = contractInput({ no: 'HT-CMD-REPLAY' })
    const first = await postContract(ctx, token, body, { 'idempotency-key': 'replay-key' })
    expect(first.status).toBe(200)
    const second = await postContract(ctx, token, body, { 'idempotency-key': 'replay-key' })
    expect(second.status).toBe(200)
    const secondBody = await second.json() as { version: number }
    expect(secondBody.version).toBe(1)

    const list = await ctx.app.request(`${BASE_URL}/api/contracts`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const listBody = await list.json() as { total: number }
    expect(listBody.total).toBe(1)
  })

  it('过期 If-Match 返回 409 STALE_WRITE 与当前版本', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    const response = await postContract(
      ctx,
      token,
      contractInput({ no: 'HT-CMD-STALE' }),
      { 'idempotency-key': 'stale-key', 'if-match': '"v999"' },
    )
    expect(response.status).toBe(409)
    const body = await response.json() as {
      code: string
      details: { currentVersion: number }
    }
    expect(body.code).toBe('STALE_WRITE')
    expect(body.details.currentVersion).toBe(0)
  })
})

describe('校验与未知命令', () => {
  it('入参校验失败返回 422 VALIDATION_FAILED', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    const invalid = { ...contractInput({ no: 'HT-CMD-BAD' }), amountCents: -1 }
    const response = await postContract(ctx, token, invalid, { 'idempotency-key': 'validation-key' })
    expect(response.status).toBe(422)
    const body = await response.json() as { code: string; details: { fields: unknown[] } }
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.details.fields.length).toBeGreaterThan(0)
  })

  it('未知命令返回 404 NOT_FOUND', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    const response = await ctx.app.request(`${BASE_URL}/api/commands/unknown.command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': 'unknown-key',
      },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(404)
    const body = await response.json() as { code: string }
    expect(body.code).toBe('NOT_FOUND')
  })
})
