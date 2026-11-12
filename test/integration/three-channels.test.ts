/**
 * 8.1 跨通道端到端：同一合同与同一笔付款经 CLI（直接 dispatch）、HTTP、MCP 三个通道提交。
 * 三个通道使用同一 actor 与同一幂等键，因此后两次必须命中首次结果：
 * 只产生一条合同、一条流水、两条审计（每个不同的成功写各一条），且三方读到的合同视图完全一致。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dispatch, type CommandResult } from '@ledger/core'
import { PairingCodeService, createAgentToken, createApp, type LedgerApp } from '@ledger/server'
import {
  contractInput,
  createIntegrationContext,
  expectSuccess,
  isCommandResult,
  isRecord,
  readNumber,
  readRecord,
  readString,
  type IntegrationContext,
} from './helpers.js'
import { createMcpHarness, type McpHarness } from './mcp-harness.js'

/** 与安全中间件白名单一致的虚拟端口（仅用于 app.request，不真正监听）。 */
const TEST_PORT = 4517

/** 虚拟基地址。 */
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`

/** 三个通道共用同一操作者，幂等键作用域 (actor, command, key) 才能一致。 */
const ACTOR = 'integration-agent'

/** 合同幂等键。 */
const CONTRACT_KEY = 'cross-channel-contract-1'

/** 付款幂等键。 */
const PAYMENT_KEY = 'cross-channel-payment-1'

/** 审计投影行。 */
interface AuditRow {
  command: string
  transport: string
  idempotency_key: string | null
}

/** HTTP 命令响应。 */
interface HttpCommandResponse {
  status: number
  result: CommandResult<unknown>
}

/**
 * 通过 HTTP 命令端点提交一条命令。
 * @param app Hono 应用
 * @param token Bearer 令牌
 * @param name 点号命令名
 * @param body 业务入参
 * @param key 幂等键
 * @returns 状态码与统一信封
 */
async function postCommand(
  app: LedgerApp,
  token: string,
  name: string,
  body: Record<string, unknown>,
  key: string,
): Promise<HttpCommandResponse> {
  const response = await app.request(`${BASE_URL}/api/commands/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'idempotency-key': key,
    },
    body: JSON.stringify(body),
  })
  const json: unknown = await response.json()
  if (!isCommandResult(json)) {
    throw new Error('HTTP 响应不是统一命令信封。')
  }
  return { status: response.status, result: json }
}

/**
 * 从命令信封中读取合同视图。
 * @param result 命令结果
 * @returns 合同视图
 */
function readContractView(result: CommandResult<unknown>): Record<string, unknown> {
  const success = expectSuccess(result)
  if (!isRecord(success.data)) throw new Error('命令结果 data 不是对象。')
  return readRecord(success.data, 'contract')
}

describe('8.1 三通道端到端一致性', () => {
  let ctx: IntegrationContext
  let mcp: McpHarness
  let app: LedgerApp
  let token: string

  beforeAll(async () => {
    ctx = await createIntegrationContext()
    token = createAgentToken(ctx.db, { actor: ACTOR, label: 'integration' }).token
    app = createApp({
      store: ctx.store,
      db: ctx.db,
      registry: ctx.registry,
      pairing: new PairingCodeService(),
      port: TEST_PORT,
    })
    mcp = await createMcpHarness(ctx.registry, ctx.store, ACTOR)
  })

  afterAll(async () => {
    await mcp.close()
    ctx.dispose()
  })

  it('同一合同与同一笔付款经三通道只落一份数据且视图一致', async () => {
    const input = contractInput({ no: 'HT-CROSS-1', amountCents: 100_000 })

    // 通道 A：CLI 等价路径，直接调用共享 dispatch。
    const cliCreate = await dispatch(ctx.registry, 'contract.upsert', input, {
      store: ctx.store,
      actor: ACTOR,
      transport: 'cli',
      idempotencyKey: CONTRACT_KEY,
    })
    // 通道 B：HTTP 命令端点（Bearer 认证）。
    const httpCreate = await postCommand(app, token, 'contract.upsert', input, CONTRACT_KEY)
    // 通道 C：MCP 内存传输工具调用。
    const mcpCreate = await mcp.callTool('contract_upsert', {
      ...input,
      idempotency_key: CONTRACT_KEY,
    })

    expect(httpCreate.status).toBe(200)
    const cliContract = readContractView(cliCreate)
    const httpContract = readContractView(httpCreate.result)
    const mcpContract = readContractView(mcpCreate)

    expect(expectSuccess(cliCreate).meta.transport).toBe('cli')
    expect(expectSuccess(httpCreate.result).meta.transport).toBe('http')
    expect(expectSuccess(mcpCreate).meta.transport).toBe('mcp')

    const contractId = readString(cliContract, 'id')
    expect(readString(httpContract, 'id')).toBe(contractId)
    expect(readString(mcpContract, 'id')).toBe(contractId)
    expect(expectSuccess(cliCreate).version).toBe(1)
    expect(expectSuccess(httpCreate.result).version).toBe(1)
    expect(expectSuccess(mcpCreate).version).toBe(1)

    const contractRows = ctx.db
      .prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM contracts')
      .get()
    expect(contractRows?.total).toBe(1)

    const paymentInput: Record<string, unknown> = {
      contractId,
      date: '2026-02-01',
      amountCents: 40_000,
      methodCode: 'transfer',
      note: '跨通道收款',
    }

    const cliPayment = await dispatch(ctx.registry, 'payment.record', paymentInput, {
      store: ctx.store,
      actor: ACTOR,
      transport: 'cli',
      idempotencyKey: PAYMENT_KEY,
    })
    const httpPayment = await postCommand(app, token, 'payment.record', paymentInput, PAYMENT_KEY)
    const mcpPayment = await mcp.callTool('payment_record', {
      ...paymentInput,
      idempotency_key: PAYMENT_KEY,
    })

    expect(httpPayment.status).toBe(200)
    expect(expectSuccess(cliPayment).meta.transport).toBe('cli')
    expect(expectSuccess(httpPayment.result).meta.transport).toBe('http')
    expect(expectSuccess(mcpPayment).meta.transport).toBe('mcp')

    const cliView = readContractView(cliPayment)
    const httpView = readContractView(httpPayment.result)
    const mcpView = readContractView(mcpPayment)

    expect(expectSuccess(cliPayment).version).toBe(2)
    expect(expectSuccess(httpPayment.result).version).toBe(2)
    expect(expectSuccess(mcpPayment).version).toBe(2)

    // 三个通道读到的派生值必须完全一致。
    expect(httpView).toEqual(cliView)
    expect(mcpView).toEqual(cliView)
    expect(readNumber(cliView, 'paidCents')).toBe(40_000)
    expect(readNumber(cliView, 'fundingPercent')).toBe(40)

    const paymentRows = ctx.db
      .prepare<[], { total: number; amount: number }>(
        'SELECT COUNT(*) AS total, COALESCE(SUM(amount_cents), 0) AS amount FROM payments',
      )
      .get()
    expect(paymentRows?.total).toBe(1)
    expect(paymentRows?.amount).toBe(40_000)

    // 只允许两条审计：contract.upsert 与 payment.record 各一次；重放不新增。
    const audit = ctx.db
      .prepare<[], AuditRow>(
        `SELECT command, transport, idempotency_key
           FROM audit_log
          ORDER BY rowid ASC`,
      )
      .all()
    expect(audit).toHaveLength(2)
    expect(audit.map((row) => row.command)).toEqual(['contract.upsert', 'payment.record'])
    expect(audit.map((row) => row.idempotency_key)).toEqual([CONTRACT_KEY, PAYMENT_KEY])
    expect(audit.map((row) => row.transport)).toEqual(['cli', 'cli'])
  })
})
