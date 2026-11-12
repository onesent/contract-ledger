import { describe, expect, it } from 'vitest'
import {
  InMemoryTransport,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server'
import {
  InMemoryTransport as LegacyInMemoryTransport,
} from '@modelcontextprotocol/sdk/inMemory.js'
import type { JSONRPCMessage as LegacyJSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createLegacyServer, createMcpServer } from '@ledger/mcp'
import { CONTRACT_ID, createSeededStore, createTestRegistry } from './fixtures.js'

/** 传输层最小接口：v1 与 v2 的 InMemoryTransport 都满足。 */
interface RpcTransport<M> {
  onmessage?: (message: M) => void
  start(): Promise<void>
  send(message: M): Promise<void>
}

/** 等待中的 JSON-RPC 响应。 */
interface PendingResponse {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/** 测试用 JSON-RPC 客户端。 */
interface RpcClient {
  start(): Promise<void>
  request(method: string, params: Record<string, unknown>): Promise<unknown>
  notify(method: string, params: Record<string, unknown>): Promise<void>
}

/**
 * 把未知值收敛成普通对象。
 * @param value 任意值
 * @returns 普通对象；非对象返回 null
 */
function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return Object.fromEntries(Object.entries(value))
}

/**
 * 创建按 id 匹配响应的 JSON-RPC 客户端。
 * @param transport 传输层
 * @param encodeRequest 请求编码器
 * @param encodeNotification 通知编码器
 * @returns 测试客户端
 */
function createRpcClient<M>(
  transport: RpcTransport<M>,
  encodeRequest: (id: number, method: string, params: unknown) => M,
  encodeNotification: (method: string, params: unknown) => M,
): RpcClient {
  const pending = new Map<number, PendingResponse>()
  let nextId = 1

  transport.onmessage = (message) => {
    const record = toRecord(message)
    if (record === null) return
    const id = record.id
    if (typeof id !== 'number') return
    const waiter = pending.get(id)
    if (waiter === undefined) return
    pending.delete(id)
    if (record.error !== undefined) {
      waiter.reject(new Error(JSON.stringify(record.error)))
      return
    }
    waiter.resolve(record.result)
  }

  return {
    start: () => transport.start(),
    async request(method, params) {
      const id = nextId
      nextId += 1
      const response = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })
      await transport.send(encodeRequest(id, method, params))
      return response
    },
    async notify(method, params) {
      await transport.send(encodeNotification(method, params))
    },
  }
}

/**
 * 读取工具列表并返回按名称索引的工具定义。
 * @param result tools/list 的 result
 * @returns 工具名到定义的映射
 */
function readTools(result: unknown): Map<string, Record<string, unknown>> {
  const record = toRecord(result)
  const tools = record?.tools
  const byName = new Map<string, Record<string, unknown>>()
  if (!Array.isArray(tools)) return byName
  for (const item of tools) {
    const tool = toRecord(item)
    const name = tool?.name
    if (tool !== null && typeof name === 'string') byName.set(name, tool)
  }
  return byName
}

/**
 * 读取工具调用结果中的结构化信封。
 * @param result tools/call 的 result
 * @returns 结构化信封；缺失返回 null
 */
function readStructured(result: unknown): Record<string, unknown> | null {
  const record = toRecord(result)
  return record === null ? null : toRecord(record.structuredContent)
}

/** v2 请求编码器。 */
function encodeV2Request(id: number, method: string, params: unknown): JSONRPCMessage {
  return { jsonrpc: '2.0', id, method, params }
}

/** v2 通知编码器。 */
function encodeV2Notification(method: string, params: unknown): JSONRPCMessage {
  return { jsonrpc: '2.0', method, params }
}

/** v1 请求编码器。 */
function encodeLegacyRequest(
  id: number,
  method: string,
  params: unknown,
): LegacyJSONRPCMessage {
  return { jsonrpc: '2.0', id, method, params }
}

/** v1 通知编码器。 */
function encodeLegacyNotification(
  method: string,
  params: unknown,
): LegacyJSONRPCMessage {
  return { jsonrpc: '2.0', method, params }
}

describe('createMcpServer (v2)', () => {
  it('tools/list 暴露全部命令、注解与写命令必填的 idempotency_key', async () => {
    const server = createMcpServer({
      registry: createTestRegistry(),
      store: createSeededStore(),
    })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = createRpcClient(
      clientTransport,
      encodeV2Request,
      encodeV2Notification,
    )

    try {
      await client.start()
      const tools = readTools(await client.request('tools/list', {}))

      expect([...tools.keys()]).toEqual([
        'contract_get',
        'contract_adjust',
        'contract_remove',
      ])
      expect(tools.get('contract_get')?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      })
      expect(tools.get('contract_remove')?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      })

      const readSchema = toRecord(tools.get('contract_get')?.inputSchema)
      const writeSchema = toRecord(tools.get('contract_adjust')?.inputSchema)
      expect(readSchema?.required).not.toContain('idempotency_key')
      expect(writeSchema?.required).toContain('idempotency_key')
    } finally {
      await server.close()
    }
  })

  it('只读调用返回 structuredContent，写命令缺少幂等键返回结构化失败信封', async () => {
    const store = createSeededStore()
    const server = createMcpServer({ registry: createTestRegistry(), store })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = createRpcClient(
      clientTransport,
      encodeV2Request,
      encodeV2Notification,
    )

    try {
      await client.start()

      const readResult = await client.request('tools/call', {
        name: 'contract_get',
        arguments: { id: CONTRACT_ID },
      })
      const readRecord = toRecord(readResult)
      expect(readRecord?.isError).toBe(false)
      const readEnvelope = readStructured(readResult)
      expect(readEnvelope?.ok).toBe(true)
      expect(toRecord(readEnvelope?.data)?.id).toBe(CONTRACT_ID)

      const failedResult = await client.request('tools/call', {
        name: 'contract_adjust',
        arguments: { id: CONTRACT_ID, amountCents: 120000 },
      })
      const failedRecord = toRecord(failedResult)
      expect(failedRecord?.isError).toBe(true)
      const failedEnvelope = readStructured(failedResult)
      expect(failedEnvelope?.ok).toBe(false)
      expect(failedEnvelope?.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
      expect(store.getVersion()).toBe(0)

      const writeResult = await client.request('tools/call', {
        name: 'contract_adjust',
        arguments: {
          id: CONTRACT_ID,
          amountCents: 120000,
          idempotency_key: 'key-1',
        },
      })
      const writeRecord = toRecord(writeResult)
      expect(writeRecord?.isError).toBe(false)
      const writeEnvelope = readStructured(writeResult)
      expect(writeEnvelope?.ok).toBe(true)
      expect(writeEnvelope?.version).toBe(1)
      expect(toRecord(writeEnvelope?.data)?.amountCents).toBe(120000)
    } finally {
      await server.close()
    }
  })
})

describe('createLegacyServer (v1)', () => {
  it('同一工具目录完成初始化、tools/list 与缺少幂等键的失败调用', async () => {
    const store = createSeededStore()
    const server = createLegacyServer({ registry: createTestRegistry(), store })
    const [serverTransport, clientTransport] = LegacyInMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = createRpcClient(
      clientTransport,
      encodeLegacyRequest,
      encodeLegacyNotification,
    )

    try {
      await client.start()
      await client.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ledger-test', version: '0.0.0' },
      })
      await client.notify('notifications/initialized', {})

      const tools = readTools(await client.request('tools/list', {}))
      expect([...tools.keys()]).toEqual([
        'contract_get',
        'contract_adjust',
        'contract_remove',
      ])
      expect(toRecord(tools.get('contract_adjust')?.inputSchema)?.required).toContain(
        'idempotency_key',
      )

      const readResult = await client.request('tools/call', {
        name: 'contract_get',
        arguments: { id: CONTRACT_ID },
      })
      expect(toRecord(readResult)?.isError).toBe(false)
      expect(readStructured(readResult)?.ok).toBe(true)

      const failedResult = await client.request('tools/call', {
        name: 'contract_adjust',
        arguments: { id: CONTRACT_ID, amountCents: 120000 },
      })
      expect(toRecord(failedResult)?.isError).toBe(true)
      expect(readStructured(failedResult)?.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
      expect(store.getVersion()).toBe(0)
    } finally {
      await server.close()
    }
  })
})
