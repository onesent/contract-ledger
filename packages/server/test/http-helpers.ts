/**
 * HTTP 集成测试助手：临时迁移库、默认字典、真实核心命令与应用实例。
 */
import { CommandRegistry, registerCoreCommands, type LedgerStore } from '@ledger/core'
import { createLedgerStore, seedDefaultDictionaries } from '@ledger/storage-sqlite'
import { createApp } from '../src/app.js'
import { createAgentToken } from '../src/auth/tokens.js'
import { PairingCodeService } from '../src/auth/pair-code.js'
import type { AppOptions, LedgerApp } from '../src/types.js'
import {
  createAuthTestContext,
  disposeAuthTestContext,
  type AuthTestContext,
} from './helpers.js'

/** 测试服务端口（与 Host / Origin 白名单一致）。 */
export const TEST_PORT = 4517

/** 测试基地址。 */
export const BASE_URL = `http://127.0.0.1:${TEST_PORT}`

/** HTTP 测试上下文。 */
export interface HttpTestContext {
  db: AuthTestContext['db']
  store: LedgerStore
  registry: CommandRegistry
  pairing: PairingCodeService
  options: AppOptions
  app: LedgerApp
  dispose: () => void
}

/** 浏览器凭证。 */
export interface BrowserCredential {
  /** 可直接放入 Cookie 请求头的会话凭证。 */
  cookie: string
  /** 双提交 CSRF 令牌。 */
  csrfToken: string
  /** 原始会话 Cookie 值。 */
  sessionValue: string
}

/**
 * 创建 HTTP 测试上下文。
 * @param config 可选的只读模式
 * @returns 上下文；调用方必须在 afterEach 中 dispose
 */
export async function createHttpTestContext(config: { readonly?: boolean } = {}): Promise<HttpTestContext> {
  const auth = await createAuthTestContext()
  seedDefaultDictionaries(auth.db)
  const store = createLedgerStore(auth.db)
  const registry = new CommandRegistry()
  registerCoreCommands(registry)
  const pairing = new PairingCodeService()
  const options: AppOptions = {
    store,
    db: auth.db,
    registry,
    pairing,
    port: TEST_PORT,
    readonly: config.readonly === true,
  }
  const app = createApp(options)
  return {
    db: auth.db,
    store,
    registry,
    pairing,
    options,
    app,
    dispose: () => disposeAuthTestContext(auth),
  }
}

/**
 * 解析响应中的 Set-Cookie 列表。
 * @param response 响应
 * @returns Cookie 名 → 值
 */
export function readSetCookies(response: Response): Map<string, string> {
  const result = new Map<string, string>()
  const headers = response.headers
  const lines =
    'getSetCookie' in headers && typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('set-cookie') ?? '').split(', ')
  for (const line of lines) {
    const first = line.split(';')[0] ?? ''
    const separator = first.indexOf('=')
    if (separator <= 0) continue
    result.set(first.slice(0, separator), first.slice(separator + 1))
  }
  return result
}

/**
 * 使用一次性配对码完成浏览器配对。
 * @param context 测试上下文
 * @returns 浏览器凭证
 */
export async function pairBrowser(context: HttpTestContext): Promise<BrowserCredential> {
  const issued = context.pairing.issue()
  const response = await context.app.request(`${BASE_URL}/api/auth/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code }),
  })
  if (response.status !== 200) {
    throw new Error(`配对失败：HTTP ${response.status}`)
  }
  const cookies = readSetCookies(response)
  const sessionValue = cookies.get('ledger_sid')
  const csrfToken = cookies.get('ledger_csrf')
  if (sessionValue === undefined || csrfToken === undefined) {
    throw new Error('配对响应缺少会话或 CSRF Cookie')
  }
  const body = await response.json() as { csrfToken?: unknown }
  if (typeof body.csrfToken !== 'string') {
    throw new Error('配对响应缺少 csrfToken 字段')
  }
  return {
    cookie: `ledger_sid=${sessionValue}; ledger_csrf=${csrfToken}`,
    csrfToken,
    sessionValue,
  }
}

/**
 * 创建 Bearer 令牌。
 * @param context 测试上下文
 * @param actor 操作者
 * @returns 明文令牌
 */
export function createBearer(context: HttpTestContext, actor = 'agent:test'): string {
  return createAgentToken(context.db, { actor, label: 'test' }).token
}

/** 合法合同输入。 */
export interface ContractInputOptions {
  no: string
  direction?: 'sale' | 'purchase'
  amountCents?: number
  counterparty?: string
}

/**
 * 构造 contract.upsert 合法入参。
 * @param input 合同编号、方向、金额与对方
 * @returns 命令入参
 */
export function contractInput(input: ContractInputOptions): Record<string, unknown> {
  return {
    no: input.no,
    projectName: `${input.no} 项目`,
    direction: input.direction ?? 'sale',
    counterparty: input.counterparty ?? '测试客户',
    typeCode: input.direction === 'purchase' ? 'purchase' : 'sales',
    statusCode: 'executing',
    ownerId: null,
    amountCents: input.amountCents ?? 100_000,
    signDate: '2026-01-01',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
    note: '',
  }
}

/**
 * 通过 HTTP 命令端点创建合同（Bearer 认证）。
 * @param context 测试上下文
 * @param token Bearer 令牌
 * @param body 合同入参
 * @returns 新合同 id
 */
export async function createContract(
  context: HttpTestContext,
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await context.app.request(`${BASE_URL}/api/commands/contract.upsert`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'idempotency-key': `seed-${String(body.no)}`,
    },
    body: JSON.stringify(body),
  })
  if (response.status !== 200) {
    throw new Error(`创建合同失败：HTTP ${response.status}`)
  }
  const payload = await response.json() as { data?: { contract?: { id?: unknown } } }
  const id = payload.data?.contract?.id
  if (typeof id !== 'string') throw new Error('创建合同响应缺少 id')
  return id
}
