/**
 * 进程内 MCP 工具调用器：用 InMemoryTransport 连接 `createMcpServer`，不启动 stdio 进程。
 * 与 HTTP/CLI 共享同一 dispatch 与幂等表，便于三通道一致性测试。
 */
import type { CommandRegistry, CommandResult, LedgerStore } from '@ledger/core'
import { createMcpServer } from '@ledger/mcp'
import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server'
import { isCommandResult, isRecord } from './helpers.js'

/** 等待中的 JSON-RPC 响应。 */
interface PendingResponse {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/** 测试用协议传输层。 */
interface RpcTransport {
  onmessage?: (message: JSONRPCMessage) => void
  start(): Promise<void>
  send(message: JSONRPCMessage): Promise<void>
}

/** 测试用 JSON-RPC 客户端。 */
interface RpcClient {
  start(): Promise<void>
  request(method: string, params: Record<string, unknown>): Promise<unknown>
}

/**
 * 把未知值收敛为普通对象副本，便于跨 JSON-RPC 联合类型读取字段。
 * @param value 任意值
 * @returns 普通对象；非对象返回 null
 */
function toRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  return Object.fromEntries(Object.entries(value))
}

/**
 * 创建按 id 匹配响应的 JSON-RPC 客户端。
 * @param transport 内存传输层
 * @returns 客户端
 */
function createRpcClient(transport: RpcTransport): RpcClient {
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
      waiter.reject(new Error(`JSON-RPC 错误：${JSON.stringify(record.error)}`))
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
      await transport.send({ jsonrpc: '2.0', id, method, params })
      return response
    },
  }
}

/** 进程内 MCP 工具调用器。 */
export interface McpHarness {
  /** 调用一个 snake_case 工具并返回统一信封。 */
  callTool(name: string, args: Record<string, unknown>): Promise<CommandResult<unknown>>
  /** 关闭内存 server。 */
  close(): Promise<void>
}

/**
 * 创建进程内 MCP server + 客户端；操作者与 HTTP Bearer 保持一致，幂等键才能跨通道复用。
 * @param registry 命令注册表
 * @param store 台账存储
 * @param actor 操作者标识
 * @returns MCP 工具调用器
 */
export async function createMcpHarness(
  registry: CommandRegistry,
  store: LedgerStore,
  actor: string,
): Promise<McpHarness> {
  const server = createMcpServer({ registry, store, actor })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = createRpcClient(clientTransport)
  await client.start()

  return {
    async callTool(name, args) {
      const result = await client.request('tools/call', { name, arguments: args })
      if (!isRecord(result)) throw new Error('MCP 工具结果不是对象。')
      const structured = result.structuredContent
      if (!isCommandResult(structured)) {
        throw new Error('MCP 工具结果缺少 structuredContent 命令信封。')
      }
      return structured
    },
    close: () => server.close(),
  }
}
