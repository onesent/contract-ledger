import { randomUUID } from 'node:crypto'
import { Command, CommanderError } from 'commander'
import { successResult, type ResultMeta } from '@ledger/core'
import { describeCatalog, jsonSchemaCatalog, type CommandSummary } from './describe.js'
import { EXIT_BUSINESS, EXIT_OK, EXIT_USAGE } from './exit-codes.js'
import { printError, printResult } from './output.js'

/** CLI 版本号；与 packages/cli/package.json 保持一致。 */
const CLI_VERSION = '0.0.0'

/** 本地服务默认地址。 */
const DEFAULT_SERVER = 'http://127.0.0.1:4517'

/** 默认数据目录。 */
const DEFAULT_DATA_DIR = 'data'

/** 全局选项的最终形态（默认值已补齐）。 */
export interface GlobalOptions {
  json: boolean
  dryRun: boolean
  yes: boolean
  idempotencyKey?: string
  server: string
  data: string
}

/** Commander 解析出的原始全局选项：未提供的键保持缺省，便于与父命令合并。 */
interface RawGlobalOptions {
  json?: boolean
  dryRun?: boolean
  yes?: boolean
  idempotencyKey?: string
  server?: string
  data?: string
}

/** `describe` 子命令自己的选项。 */
interface DescribeOptions {
  schema?: boolean
}

/**
 * 为命令注册全局选项。布尔选项不设 Commander 默认值，
 * 这样 `ledger --json describe` 与 `ledger describe --json` 都能被 `optsWithGlobals` 合并。
 * @param command 目标命令
 * @returns 同一个命令，便于链式调用
 */
function addGlobalOptions(command: Command): Command {
  return command
    .option('--json', '输出单行 JSON 信封（隐含非交互，stdout 仅机器可读）')
    .option('--dry-run', '仅预览变更，不写入数据')
    .option('--yes', '跳过交互确认')
    .option('--idempotency-key <key>', '写命令的幂等键（相同键 + 相同内容重放）')
    .option('--server <url>', `本地服务地址（默认 ${DEFAULT_SERVER}）`)
    .option('--data <dir>', `数据目录（默认 ${DEFAULT_DATA_DIR}）`)
}

/**
 * 合并子命令与其祖先命令的全局选项，并补齐默认值。
 * @param command 当前执行的命令
 * @returns 完整的全局选项
 */
export function resolveGlobalOptions(command: Command): GlobalOptions {
  const raw = command.optsWithGlobals<RawGlobalOptions>()
  return {
    json: raw.json === true,
    dryRun: raw.dryRun === true,
    yes: raw.yes === true,
    idempotencyKey: raw.idempotencyKey,
    server: raw.server ?? DEFAULT_SERVER,
    data: raw.data ?? DEFAULT_DATA_DIR,
  }
}

/**
 * 构造统一结果信封的元信息。
 * @param options 全局选项
 * @param startedAt 命令开始时间（毫秒时间戳）
 * @returns 结果元信息
 */
function buildMeta(options: GlobalOptions, startedAt: number): ResultMeta {
  return {
    requestId: randomUUID(),
    durationMs: Date.now() - startedAt,
    dryRun: options.dryRun,
    actor: 'cli:local',
    transport: 'cli',
  }
}

/**
 * 创建 Commander 程序；不执行任何命令，便于测试直接复用。
 * @returns 已注册全局选项与子命令的 Commander 实例
 */
export function createProgram(): Command {
  const program = new Command()
  program
    .name('ledger')
    .description('本地合同台账的 agent 命令行接口')
    .version(CLI_VERSION)
  addGlobalOptions(program)
  program.showHelpAfterError()

  const describeCommand = addGlobalOptions(program.command('describe'))
  describeCommand
    .description('输出机器可读的能力描述（命令、字段、枚举、错误码）')
    .option('--schema', '仅输出 JSON Schema 目录')
    .action((options: DescribeOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const catalog = describeCatalog()

      if (options.schema === true) {
        process.stdout.write(`${JSON.stringify(jsonSchemaCatalog(catalog), null, 2)}\n`)
        return
      }

      const startedAt = Date.now()
      const commands: CommandSummary[] = []
      const data = { ...catalog, commands }
      const result = successResult({ data, version: 0, meta: buildMeta(globals, startedAt) })
      printResult('describe', result)

      if (!globals.json) {
        printError(`已输出能力描述：${data.errorCodes.length} 个错误码，${commands.length} 条命令。`)
      }
    })

  return program
}

/**
 * CLI 入口：解析参数并返回进程退出码，不直接调用 `process.exit()`。
 * @param argv 不含 node 与脚本路径的参数
 * @returns 0 成功 / 1 业务失败 / 2 用法错误 / 4 未认证（由子命令错误映射）
 */
export async function main(argv: readonly string[]): Promise<number> {
  const program = createProgram()
  overrideExit(program)

  try {
    await program.parseAsync([...argv], { from: 'user' })
    return EXIT_OK
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? EXIT_OK : EXIT_USAGE
    }
    printError(`ledger: ${errorMessage(error)}`)
    return EXIT_BUSINESS
  }
}

/**
 * 递归覆盖所有命令的退出行为：Commander 在注册子命令时复制父命令设置，
 * 因此子命令创建后再对根命令调用 `exitOverride()` 不会生效，需要逐个覆盖。
 * @param command 根命令
 */
function overrideExit(command: Command): void {
  command.exitOverride()
  for (const child of command.commands) {
    overrideExit(child)
  }
}

/**
 * 把未知异常转成可读文案。
 * @param error 捕获到的异常
 * @returns 异常消息
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
