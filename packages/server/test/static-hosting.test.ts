/**
 * 同源静态托管：页面与 API 的响应头分层、静态资源命中、SPA 回落与未命中 404。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { API_CSP, PAGE_CSP } from '../src/app.js'
import { BASE_URL, createBearer, createHttpTestContext, type HttpTestContext } from './http-helpers.js'

/** 页面入口内的标记，用于确认回落返回的是 index.html。 */
const INDEX_MARKER = '<div id="app" data-test="index"></div>'

/** 当前测试上下文。 */
let context: HttpTestContext | null = null

/** 当前临时前端目录。 */
let webDir: string | null = null

afterEach(() => {
  context?.dispose()
  context = null
  if (webDir !== null) {
    rmSync(webDir, { recursive: true, force: true })
    webDir = null
  }
})

/**
 * 创建带前端产物的临时目录。
 * @returns 前端目录路径
 */
function createWebDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-web-'))
  mkdirSync(path.join(dir, 'assets'), { recursive: true })
  writeFileSync(
    path.join(dir, 'index.html'),
    `<!DOCTYPE html><html lang="zh-CN"><head><title>台账</title></head><body>${INDEX_MARKER}</body></html>`,
  )
  writeFileSync(path.join(dir, 'assets', 'index-abc.js'), 'console.log("ledger")\n')
  return dir
}

/**
 * 创建启用静态托管的上下文。
 * @returns 测试上下文
 */
async function setupWithWebDir(): Promise<HttpTestContext> {
  webDir = createWebDir()
  context = await createHttpTestContext({ webDir })
  return context
}

describe('同源静态托管', () => {
  it('根路径返回 index.html 并使用页面 CSP', async () => {
    const ctx = await setupWithWebDir()
    const response = await ctx.app.request(`${BASE_URL}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(INDEX_MARKER)
    expect(response.headers.get('content-security-policy')).toBe(PAGE_CSP)
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('静态资源命中并带正确 Content-Type', async () => {
    const ctx = await setupWithWebDir()
    const response = await ctx.app.request(`${BASE_URL}/assets/index-abc.js`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('ledger')
    expect(response.headers.get('content-type')).toContain('javascript')
  })

  it('前端路由路径回落 index.html', async () => {
    const ctx = await setupWithWebDir()
    const response = await ctx.app.request(`${BASE_URL}/contracts/42`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(INDEX_MARKER)
  })

  it('缺失的资源路径不回退 index.html', async () => {
    const ctx = await setupWithWebDir()
    const response = await ctx.app.request(`${BASE_URL}/assets/missing.js`)
    expect(response.status).toBe(404)
    const body = await response.json() as { code: string }
    expect(body.code).toBe('NOT_FOUND')
  })

  it('API 路径保持最严 CSP 与不缓存', async () => {
    const ctx = await setupWithWebDir()
    const response = await ctx.app.request(`${BASE_URL}/api/health`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe(API_CSP)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('未知 API 路径先过认证链，不落到静态托管', async () => {
    const ctx = await setupWithWebDir()
    const anonymous = await ctx.app.request(`${BASE_URL}/api/nope`)
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('content-type')).toContain('application/problem+json')

    const authed = await ctx.app.request(`${BASE_URL}/api/nope`, {
      headers: { authorization: `Bearer ${createBearer(ctx)}` },
    })
    expect(authed.status).toBe(404)
    expect(authed.headers.get('content-type')).toContain('application/problem+json')
    const body = await authed.json() as { code: string }
    expect(body.code).toBe('NOT_FOUND')
  })

  it('Host 白名单对页面同样生效', async () => {
    const ctx = await setupWithWebDir()
    const response = await ctx.app.request(`${BASE_URL}/`, { headers: { host: 'evil.example' } })
    expect(response.status).toBe(403)
  })

  it('未配置 webDir 时根路径仍是 problem+json 404', async () => {
    context = await createHttpTestContext()
    const response = await context.app.request(`${BASE_URL}/`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
  })
})
