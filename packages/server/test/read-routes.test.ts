/**
 * 只读端点：分页、筛选、排序、ETag、认证要求与统计/提醒形状。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  BASE_URL,
  contractInput,
  createBearer,
  createContract,
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

describe('合同列表', () => {
  it('服务端分页、方向筛选、排序与总数正确', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    await createContract(ctx, token, contractInput({ no: 'HT-SALE-1', direction: 'sale', amountCents: 100 }))
    await createContract(ctx, token, contractInput({ no: 'HT-SALE-2', direction: 'sale', amountCents: 200 }))
    await createContract(ctx, token, contractInput({ no: 'HT-PUR-1', direction: 'purchase', amountCents: 300 }))
    await createContract(ctx, token, contractInput({ no: 'HT-PUR-2', direction: 'purchase', amountCents: 400 }))
    await createContract(ctx, token, contractInput({ no: 'HT-PUR-3', direction: 'purchase', amountCents: 500 }))

    const first = await ctx.app.request(
      `${BASE_URL}/api/contracts?direction=purchase&page=1&pageSize=2&sortBy=no&sortOrder=asc`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    expect(first.status).toBe(200)
    const firstBody = await first.json() as {
      items: Array<{ no: string }>
      total: number
      page: number
      pageSize: number
    }
    expect(firstBody.total).toBe(3)
    expect(firstBody.page).toBe(1)
    expect(firstBody.pageSize).toBe(2)
    expect(firstBody.items.map((item) => item.no)).toEqual(['HT-PUR-1', 'HT-PUR-2'])

    const second = await ctx.app.request(
      `${BASE_URL}/api/contracts?direction=purchase&page=2&pageSize=2&sortBy=no&sortOrder=asc`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    const secondBody = await second.json() as { items: Array<{ no: string }>; total: number }
    expect(secondBody.total).toBe(3)
    expect(secondBody.items.map((item) => item.no)).toEqual(['HT-PUR-3'])
  })

  it('列表返回 ETag 版本且无凭证返回 401', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    await createContract(ctx, token, contractInput({ no: 'HT-ETAG-1' }))
    const response = await ctx.app.request(`${BASE_URL}/api/contracts`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"v1"')

    const unauthorized = await ctx.app.request(`${BASE_URL}/api/contracts`)
    expect(unauthorized.status).toBe(401)
    const body = await unauthorized.json() as { code: string }
    expect(body.code).toBe('AUTH_REQUIRED')
  })
})

describe('详情与关联集合', () => {
  it('合同详情包含合同、流水、交付与状态日志', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    const id = await createContract(ctx, token, contractInput({ no: 'HT-DETAIL-1' }))
    const response = await ctx.app.request(`${BASE_URL}/api/contracts/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as {
      contract: { id: string; no: string; paidCents: number }
      payments: unknown[]
      deliveries: unknown[]
      statusLogs: unknown[]
    }
    expect(body.contract.id).toBe(id)
    expect(body.contract.no).toBe('HT-DETAIL-1')
    expect(body.payments).toEqual([])
    expect(body.deliveries).toEqual([])
    expect(body.statusLogs).toHaveLength(1)

    const missing = await ctx.app.request(`${BASE_URL}/api/contracts/00000000-0000-4000-8000-000000000000`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(missing.status).toBe(404)
  })

  it('流水、交付、人员与字典列表可用', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    const headers = { authorization: `Bearer ${token}` }
    for (const path of ['/api/payments', '/api/deliveries', '/api/personnel', '/api/dicts']) {
      const response = await ctx.app.request(`${BASE_URL}${path}`, { headers })
      expect(response.status).toBe(200)
      const body = await response.json() as { items: unknown[] }
      expect(Array.isArray(body.items)).toBe(true)
    }
    const dicts = await ctx.app.request(`${BASE_URL}/api/dicts?categoryCode=contractStatus`, { headers })
    const dictsBody = await dicts.json() as { items: Array<{ categoryCode: string }> }
    expect(dictsBody.items.length).toBeGreaterThan(0)
    expect(dictsBody.items.every((item) => item.categoryCode === 'contractStatus')).toBe(true)
  })
})

describe('统计与提醒', () => {
  it('按方向统计只包含该方向合同', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    await createContract(ctx, token, contractInput({ no: 'HT-STAT-S1', direction: 'sale', amountCents: 100 }))
    await createContract(ctx, token, contractInput({ no: 'HT-STAT-P1', direction: 'purchase', amountCents: 300 }))
    await createContract(ctx, token, contractInput({ no: 'HT-STAT-P2', direction: 'purchase', amountCents: 700 }))
    const response = await ctx.app.request(`${BASE_URL}/api/stats?direction=purchase`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as {
      direction: string
      stats: { contractCount: number; totalAmountCents: number }
    }
    expect(body.direction).toBe('purchase')
    expect(body.stats.contractCount).toBe(2)
    expect(body.stats.totalAmountCents).toBe(1000)
  })

  it('提醒返回固定分组结构', async () => {
    const ctx = await setup()
    const token = createBearer(ctx)
    await createContract(ctx, token, contractInput({ no: 'HT-REM-1' }))
    const response = await ctx.app.request(`${BASE_URL}/api/reminders`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as {
      reminders: Array<{ key: string; count: number; items: unknown[] }>
    }
    expect(body.reminders.length).toBeGreaterThan(0)
    const first = body.reminders[0]
    expect(typeof first?.key).toBe('string')
    expect(typeof first?.count).toBe('number')
    expect(Array.isArray(first?.items)).toBe(true)
  })
})
