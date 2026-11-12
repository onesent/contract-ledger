/**
 * 能力发现产物渲染：schema/commands.json、docs/AGENTS.ledger.md 与 llms.txt。
 * 所有输出只依赖注册表内容，不含时间戳或路径，重复执行必须逐字节一致。
 */
import type { CommandAnnotations } from '@ledger/core'
import type { ToolDef } from './tools.js'

/** 默认数据集 schema 版本（与 core 的 DATASET_SCHEMA_VERSION 保持一致）。 */
const DEFAULT_SCHEMA_VERSION = 3

/** commands.json 中的单条命令。 */
export interface DiscoveryCommand {
  name: string
  toolName: string
  summary: string
  annotations: CommandAnnotations
  errorCodes: readonly string[]
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
}

/** 三个发现产物的完整内容。 */
export interface DiscoveryArtifacts {
  commandsJson: string
  agentsMarkdown: string
  llmsTxt: string
}

/** 渲染参数。 */
export interface RenderDiscoveryOptions {
  /** commands.json 的 schemaVersion；缺省 3。 */
  schemaVersion?: number
}

/**
 * 把工具定义转成 commands.json 的命令条目。
 * @param tools 工具定义列表
 * @returns 可序列化的命令条目
 */
function toDiscoveryCommands(tools: readonly ToolDef[]): DiscoveryCommand[] {
  return tools.map((tool) => ({
    name: tool.commandName,
    toolName: tool.name,
    summary: tool.summary,
    annotations: tool.annotations,
    errorCodes: tool.errorCodes,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }))
}

/**
 * 生成 commands.json 文本。
 * @param tools 工具定义列表
 * @param schemaVersion 数据集 schema 版本
 * @returns 稳定格式的 JSON（两级缩进 + 末尾换行）
 */
export function renderCommandsJson(
  tools: readonly ToolDef[],
  schemaVersion: number = DEFAULT_SCHEMA_VERSION,
): string {
  const payload = {
    schemaVersion,
    commands: toDiscoveryCommands(tools),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * 生成面向 agent 的中文说明文档。
 * @param tools 工具定义列表
 * @returns Markdown 文本
 */
export function renderAgentsMarkdown(tools: readonly ToolDef[]): string {
  const rows = tools.map((tool) => {
    const kind = tool.annotations.readOnlyHint
      ? '只读'
      : tool.annotations.destructiveHint
        ? '破坏性写'
        : '写'
    return `| \`${tool.commandName}\` | \`${tool.name}\` | ${kind} | ${tool.summary} |`
  })
  const commandTable =
    rows.length === 0
      ? '_当前注册表未包含命令；先完成核心命令注册后重新生成。_'
      : [
          '| 命令 | MCP 工具 | 类型 | 摘要 |',
          '| --- | --- | --- | --- |',
          ...rows,
        ].join('\n')

  return [
    '# 台账 Agent 操作指南',
    '',
    '本文件由 `npm run discovery -w @ledger/mcp` 自动生成，请勿手工编辑。',
    '',
    '## 调用方式',
    '',
    '- CLI：`ledger <command> --json`，例如 `ledger contract list --json`。',
    '- MCP：stdio 启动 `ledger-mcp`（默认 2026-07-28 协议），`--legacy` 切到 v1 协议。',
    '- HTTP：`Authorization: Bearer <token>`，命令名与 CLI 相同。',
    '',
    '## 幂等与并发',
    '',
    '1. 所有写命令都必须携带 `idempotency_key`；建议每次业务操作生成一个新的 UUID。',
    '2. 相同 `idempotency_key` 与相同入参重放首次结果，不会重复写入。',
    '3. 相同 `idempotency_key` 用于不同内容会返回 `IDEMPOTENCY_KEY_REUSED`。',
    '4. 需要防止覆盖他人写入时传 `expected_version`；版本不一致返回 `STALE_WRITE` 与当前版本。',
    '5. `dry_run: true` 只返回将发生的 `diff`，不写入、不递增版本。',
    '',
    '## 错误处理',
    '',
    '所有通道共享同一信封：成功 `{ ok: true, data, version, diff?, meta }`，失败 `{ ok: false, code, message, hint, details?, retryable, meta }`。',
    '按 `code` 分支处理，不要解析 `message`；`hint` 给出可执行的下一步。',
    '',
    '## 命令一览',
    '',
    commandTable,
    '',
  ].join('\n')
}

/**
 * 生成 llms.txt 入口清单。
 * @param tools 工具定义列表
 * @returns 纯文本
 */
export function renderLlmsTxt(tools: readonly ToolDef[]): string {
  const commandLines =
    tools.length === 0
      ? ['- _当前注册表未包含命令；先完成核心命令注册后重新生成。_']
      : tools.map((tool) => `- \`${tool.name}\`（${tool.commandName}）：${tool.summary}`)

  return [
    '# 合同台账 Ledger',
    '',
    '> 单库、幂等、可审计的合同台账；CLI / HTTP / MCP 共用同一命令契约。',
    '',
    '## 功能',
    '',
    '- 合同、付款、交付、人员档案与字典维护。',
    '- 乐观并发（`expected_version`）、幂等重放与 dry-run 差异预览。',
    '- 统一结果信封与稳定错误码，所有通道行为一致。',
    '',
    '## 命令',
    '',
    ...commandLines,
    '',
    '## 认证步骤',
    '',
    '1. 首次使用在服务终端获取一次性配对码。',
    '2. 执行 `ledger auth token` 换取 Bearer 令牌（令牌仅存本机）。',
    '3. HTTP 请求携带 `Authorization: Bearer <token>`；stdio MCP 默认只允许本机进程调用。',
    '4. 令牌失效后执行 `ledger auth rotate` 生成新令牌。',
    '',
  ].join('\n')
}

/**
 * 渲染全部发现产物。
 * @param tools 工具定义列表
 * @param options 可选的 schemaVersion
 * @returns 三个产物的文本内容
 */
export function renderDiscoveryArtifacts(
  tools: readonly ToolDef[],
  options: RenderDiscoveryOptions = {},
): DiscoveryArtifacts {
  const schemaVersion = options.schemaVersion ?? DEFAULT_SCHEMA_VERSION
  return {
    commandsJson: renderCommandsJson(tools, schemaVersion),
    agentsMarkdown: renderAgentsMarkdown(tools),
    llmsTxt: renderLlmsTxt(tools),
  }
}
