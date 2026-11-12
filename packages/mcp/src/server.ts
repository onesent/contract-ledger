/**
 * stdio MCP server：用命令注册表生成工具目录，默认走 v2（2026-07-28）协议，
 * `--legacy` 时走 v1 SDK。两条路径共享同一 dispatch，行为与信封保持一致。
 */
import { z } from 'zod'
import {
  dispatch,
  type CommandRegistry,
  type CommandResult,
  type JsonSchemaObject,
  type LedgerStore,
} from '@ledger/core'
import {
  McpServer,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'
import { Server as LegacyServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport as LegacyStdioTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { buildToolDefs, splitArguments, type ToolDef } from './tools.js'

/** 默认操作者；CLI/HTTP 分别使用自己的 actor。 */
const DEFAULT_ACTOR = 'mcp:stdio'

/** MCP server 身份信息。 */
const SERVER_INFO = { name: 'ledger-mcp', version: '0.0.0' } as const

/** 工具调用结果：成功与失败都带结构化信封，失败额外标记 isError。 */
interface ToolCallResult {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  structuredContent: Record<string, unknown>
  isError: boolean
}

/** 创建 MCP server 的参数。 */
export interface CreateMcpServerOptions {
  /** 命令注册表。 */
  registry: CommandRegistry
  /** 台账存储。 */
  store: LedgerStore
  /** 操作者标识；缺省 mcp:stdio。 */
  actor?: string
}

/** runStdio 的参数：额外支持协议版本开关。 */
export interface RunStdioOptions extends CreateMcpServerOptions {
  /** true 时使用 @modelcontextprotocol/sdk v1；缺省为 v2。 */
  legacy?: boolean
}

/** 已启动的 stdio server 句柄。 */
export interface RunningStdioServer {
  close(): Promise<void>
}

/**
 * 输出 schema：工具返回的是统一信封，而不是命令的 data 本身。
 * 只约束 ok 字段，其余字段由信封自由扩展。
 */
const ENVELOPE_OUTPUT_SCHEMA = z.looseObject({ ok: z.boolean() })

/** 信封 JSON Schema，供 v1 tools/list 复用。 */
const ENVELOPE_OUTPUT_JSON: JsonSchemaObject = {
  ...z.toJSONSchema(ENVELOPE_OUTPUT_SCHEMA, { target: 'draft-2020-12' }),
}

/**
 * 判断值是否为普通 JSON 对象（排除 null 与数组）。
 * @param value 任意值
 * @returns 是否为对象
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * v2 运行时入参 schema：tools/list 宣告严格 schema，但校验层保持宽松，
 * 让缺失 idempotency_key 等错误进入 dispatch，返回统一失败信封而非 SDK 原始错误。
 * @param tool 工具定义
 * @returns 带 JSON Schema 转换的 Standard Schema
 */
function createRuntimeInputSchema(tool: ToolDef): StandardSchemaWithJSON {
  const lenient = z.looseObject({})['~standard']
  return {
    '~standard': {
      version: lenient.version,
      vendor: lenient.vendor,
      validate: (value) => lenient.validate(value),
      jsonSchema: {
        input: () => tool.inputSchema,
        output: () => tool.inputSchema,
      },
    },
  }
}

/**
 * 把统一结果信封转成 MCP 工具结果。
 * @param result dispatch 返回的信封
 * @returns structuredContent + 文本 + isError
 */
function toToolCallResult(result: CommandResult<unknown>): ToolCallResult {
  const structuredContent: Record<string, unknown> = { ...result }
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent,
    isError: !result.ok,
  }
}

/**
 * 执行一条工具调用并套上统一信封。
 * @param options server 选项
 * @param commandName 点号命令名
 * @param args 原始工具参数
 * @returns 工具调用结果
 */
async function callCommand(
  options: CreateMcpServerOptions,
  commandName: string,
  args: unknown,
): Promise<ToolCallResult> {
  const { input, idempotencyKey, expectedVersion, dryRun } = splitArguments(args)
  const result = await dispatch(options.registry, commandName, input, {
    store: options.store,
    actor: options.actor ?? DEFAULT_ACTOR,
    transport: 'mcp',
    idempotencyKey,
    expectedVersion,
    dryRun,
  })
  return toToolCallResult(result)
}

/**
 * 把 JSON Schema 收敛成 v1 SDK 的 Tool schema 形状。
 * @param schema 原始 JSON Schema
 * @returns v1 Tool inputSchema/outputSchema
 */
function toLegacyToolSchema(schema: JsonSchemaObject): Tool['inputSchema'] {
  const output: Tool['inputSchema'] = { type: 'object' }
  const properties = schema.properties
  if (isJsonObject(properties)) {
    const normalized: Record<string, object> = {}
    for (const [key, value] of Object.entries(properties)) {
      if (isJsonObject(value)) normalized[key] = value
    }
    output.properties = normalized
  }
  const required = schema.required
  if (Array.isArray(required)) {
    output.required = required.filter((item): item is string => typeof item === 'string')
  }
  // 判别联合（dict.upsert 等）必须保留 oneOf/anyOf，否则 v1 客户端看不到分支。
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const variants = schema[keyword]
    if (Array.isArray(variants)) output[keyword] = variants
  }
  const additionalProperties = schema.additionalProperties
  if (typeof additionalProperties === 'boolean') {
    output.additionalProperties = additionalProperties
  }
  const schemaUrl = schema.$schema
  if (typeof schemaUrl === 'string') output.$schema = schemaUrl
  return output
}

/**
 * 工具定义转 v1 Tool。
 * @param tool 工具定义
 * @returns v1 Tool
 */
function toLegacyTool(tool: ToolDef): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: toLegacyToolSchema(tool.inputSchema),
    outputSchema: toLegacyToolSchema(ENVELOPE_OUTPUT_JSON),
    annotations: tool.annotations,
  }
}

/**
 * 创建 v2 MCP server，并为每条命令注册一个工具。
 * @param options 注册表、存储与操作者
 * @returns 尚未连接传输层的 McpServer
 */
export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } })
  for (const tool of buildToolDefs(options.registry)) {
    const commandName = tool.commandName
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: createRuntimeInputSchema(tool),
        outputSchema: ENVELOPE_OUTPUT_SCHEMA,
        annotations: tool.annotations,
      },
      async (args: unknown) => callCommand(options, commandName, args),
    )
  }
  return server
}

/**
 * 创建 v1 MCP server（--legacy），工具目录与 v2 完全一致。
 * @param options 注册表、存储与操作者
 * @returns 尚未连接传输层的 v1 Server
 */
export function createLegacyServer(options: CreateMcpServerOptions): LegacyServer {
  const server = new LegacyServer(SERVER_INFO, { capabilities: { tools: {} } })
  const tools = buildToolDefs(options.registry)
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(toLegacyTool),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name)
    // 未知工具也走 dispatch，复用 NOT_FOUND 信封；此时没有可拆分的元参数。
    return callCommand(options, tool?.commandName ?? request.params.name, request.params.arguments)
  })

  return server
}

/**
 * 启动 stdio server：默认 v2 的 serveStdio；legacy 时连接 v1 StdioServerTransport。
 * @param options 注册表、存储、操作者与协议开关
 * @returns 可关闭的 server 句柄
 */
export async function runStdio(options: RunStdioOptions): Promise<RunningStdioServer> {
  if (options.legacy === true) {
    const server = createLegacyServer(options)
    const transport = new LegacyStdioTransport()
    await server.connect(transport)
    return {
      close: async () => {
        await server.close()
      },
    }
  }

  const handle: StdioServerHandle = serveStdio(() => createMcpServer(options))
  return {
    close: () => handle.close(),
  }
}
