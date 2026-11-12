import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Command, CommanderError } from 'commander'
import {
  failureResult,
  LedgerError,
  successResult,
  type CommandRegistry,
  type FailureResult,
  type RegisteredCommand,
  type ResultMeta,
} from '@ledger/core'
import type { OpenedLedger } from './ledger.js'
import { createCliRegistry, openLedger } from './ledger.js'
import {
  createToken,
  listSessionsForCli,
  listTokens,
  revokeSessionForCli,
  revokeToken,
  rotateToken,
} from './local/auth.js'
import { backupLedger } from './local/backup.js'
import { exportLedger } from './local/export.js'
import { importLedger, normalizeImportMode } from './local/import.js'
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  runQuery,
} from './local/query.js'
import { validateLedger } from './local/validate.js'
import { resolveBuildInfo } from '@ledger/server'
import { commandSchemaCatalog, describeCatalog, describeCommands } from './describe.js'
import { EXIT_BUSINESS, EXIT_OK, EXIT_USAGE, exitCodeForErrorCode } from './exit-codes.js'
import { printError, printResult } from './output.js'
import { runCliCommand } from './run.js'

/** CLI 版本号；与交付物、载荷 VERSION 与健康端点同源（见 @ledger/server 的 build-info）。 */
const CLI_VERSION = resolveBuildInfo().version

/** 本地服务默认地址。 */
const DEFAULT_SERVER = 'http://127.0.0.1:4517'

/** 默认数据目录。 */
const DEFAULT_DATA_DIR = 'data'

/** CLI 默认操作者（写入审计）。 */
const CLI_ACTOR = 'cli:local'

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

/** 领域命令叶子节点的入参选项。 */
interface CommandInputOptions {
  input?: string
  inputFile?: string
  expectedVersion?: string
}

/** `query` 子命令选项。 */
interface QueryOptions {
  sql: string
  limit?: string
}

/** `backup` / `export` 的 `--out` 选项。 */
interface OutOptions {
  out?: string
}

/** `import` 子命令选项。 */
interface ImportOptions {
  backup: string
  mode?: string
}

/** `auth token create` 选项。 */
interface TokenCreateOptions {
  actor?: string
  label?: string
  expiresAt?: string
}

/** `auth ... list` 选项。 */
interface AuthListOptions {
  actor?: string
}

/** `auth ... revoke` 选项。 */
interface AuthRevokeOptions {
  id: string
}

/** 本地命令执行结果：数据、可选版本与可选退出码。 */
interface LocalOutcome {
  data: unknown
  version?: number
  exitCode?: number
}

/**
 * 内部退出信号：动作处理器打印完信封后用它携带退出码，
 * 由 `main` 统一转换成进程退出码，避免任何地方调用 `process.exit()`。
 */
class CliExit extends Error {
  readonly exitCode: number

  constructor(exitCode: number) {
    super(`cli exit ${exitCode}`)
    this.name = 'CliExit'
    this.exitCode = exitCode
  }
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
    actor: CLI_ACTOR,
    transport: 'cli',
  }
}

/**
 * 把异常映射成统一失败信封；LedgerError 保留稳定错误码。
 * @param error 任意异常
 * @param meta 结果元信息
 * @returns 失败信封
 */
function toFailure(error: unknown, meta: ResultMeta): FailureResult {
  if (error instanceof LedgerError) {
    return failureResult({ code: error.code, message: error.message, details: error.details, meta })
  }
  const message = error instanceof Error ? error.message : String(error)
  return failureResult({ code: 'INTERNAL', message: `命令执行失败：${message}`, meta })
}

/**
 * 解析 JSON 文本；失败抛出稳定参数校验错误。
 * @param text 原始 JSON
 * @param source 来源描述（选项名或路径）
 * @returns 解析后的值
 */
function parseJsonText(text: string, source: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new LedgerError('VALIDATION_FAILED', `无法解析 ${source} 的 JSON，请提供合法 JSON。`)
  }
}

/**
 * 非 TTY 时读取标准输入；没有管道数据时返回空串。
 * @returns 标准输入文本
 */
function readStdinIfPiped(): string {
  if (process.stdin.isTTY === true) return ''
  try {
    return readFileSync(0, 'utf8')
  } catch {
    /* 无管道输入：按空入参处理 */
    return ''
  }
}

/**
 * 解析命令入参：`--input` > `--input-file` > 非 TTY 标准输入 > 空对象。
 * @param options 叶子命令选项
 * @returns 原始入参
 */
async function resolveInput(options: CommandInputOptions): Promise<unknown> {
  if (options.input !== undefined) {
    return parseJsonText(options.input, '--input')
  }
  if (options.inputFile !== undefined) {
    const text = await readFile(options.inputFile, 'utf8')
    return parseJsonText(text, options.inputFile)
  }
  const piped = readStdinIfPiped()
  if (piped.trim() !== '') {
    return parseJsonText(piped, '标准输入')
  }
  return {}
}

/**
 * 解析 `--expected-version`。
 * @param raw 原始字符串
 * @returns 非负整数；未提供返回 undefined
 * @throws {LedgerError} 非非负整数
 */
function parseExpectedVersion(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new LedgerError('VALIDATION_FAILED', '--expected-version 必须是非负整数。')
  }
  return value
}

/**
 * 执行一条领域命令：解析入参、打开台账、分发、打印信封并映射退出码。
 * @param registry 命令注册表
 * @param registered 注册项
 * @param options 叶子命令选项
 * @param command 当前 Commander 命令（用于合并全局选项）
 */
async function executeRegistered(
  registry: CommandRegistry,
  registered: RegisteredCommand,
  options: CommandInputOptions,
  command: Command,
): Promise<void> {
  const globals = resolveGlobalOptions(command)
  const startedAt = Date.now()
  const meta = buildMeta(globals, startedAt)

  let input: unknown
  let expectedVersion: number | undefined
  try {
    input = await resolveInput(options)
    expectedVersion = parseExpectedVersion(options.expectedVersion)
  } catch (error) {
    const failure = toFailure(error, meta)
    printResult(registered.name, failure)
    throw new CliExit(exitCodeForErrorCode(failure.code))
  }

  try {
    const opened = await openLedger({ dataDir: globals.data })
    try {
      const exitCode = await runCliCommand(registry, registered.name, input, {
        store: opened.store,
        actor: CLI_ACTOR,
        dryRun: globals.dryRun,
        idempotencyKey: globals.idempotencyKey,
        expectedVersion,
      })
      if (exitCode !== EXIT_OK) throw new CliExit(exitCode)
    } finally {
      opened.db.close()
    }
  } catch (error) {
    if (error instanceof CliExit) throw error
    const failure = toFailure(error, meta)
    printResult(registered.name, failure)
    throw new CliExit(exitCodeForErrorCode(failure.code))
  }
}

/**
 * 执行一条本地运维命令：打开台账、调用处理器、打印成功信封。
 * 处理器失败时打印失败信封并按错误码映射退出码。
 * @param commandName 输出信封中的命令名
 * @param globals 全局选项
 * @param startedAt 开始时间
 * @param handler 接收已打开台账的处理器
 */
async function executeLocal(
  commandName: string,
  globals: GlobalOptions,
  startedAt: number,
  handler: (opened: OpenedLedger) => Promise<LocalOutcome> | LocalOutcome,
): Promise<void> {
  try {
    const opened = await openLedger({ dataDir: globals.data })
    try {
      const outcome = await handler(opened)
      const version = outcome.version ?? opened.store.getVersion()
      printResult(
        commandName,
        successResult({ data: outcome.data, version, meta: buildMeta(globals, startedAt) }),
      )
      if (outcome.exitCode !== undefined && outcome.exitCode !== EXIT_OK) {
        throw new CliExit(outcome.exitCode)
      }
    } finally {
      opened.db.close()
    }
  } catch (error) {
    if (error instanceof CliExit) throw error
    const failure = toFailure(error, buildMeta(globals, startedAt))
    printResult(commandName, failure)
    throw new CliExit(exitCodeForErrorCode(failure.code))
  }
}

/**
 * 把 `contract.upsert` 拆成组名与动作名。
 * @param name 点号命令名
 * @returns 组名与动作名
 */
function splitCommandName(name: string): { group: string; action: string } {
  const dot = name.indexOf('.')
  if (dot <= 0 || dot === name.length - 1) {
    throw new Error(`非法命令名：${name}`)
  }
  return { group: name.slice(0, dot), action: name.slice(dot + 1) }
}

/**
 * 从注册表动态生成 `ledger <group> <action>` 子命令。
 * @param program 根命令
 * @param registry 命令注册表
 */
function registerDomainCommands(program: Command, registry: CommandRegistry): void {
  const groups = new Map<string, Command>()
  for (const registered of registry.list()) {
    const { group, action } = splitCommandName(registered.name)
    let groupCommand = groups.get(group)
    if (groupCommand === undefined) {
      groupCommand = program.command(group).description(`${group} 领域命令`)
      groups.set(group, groupCommand)
    }
    const leaf = groupCommand.command(action)
    leaf
      .description(registered.summary)
      .option('--input <json>', '命令入参 JSON 字符串（与 --input-file 二选一）')
      .option('--input-file <path>', '从文件读取命令入参 JSON；未提供时回退到标准输入')
      .option('--expected-version <n>', '期望的数据集版本；不一致返回 STALE_WRITE')
    addGlobalOptions(leaf)
    leaf.action(async (options: CommandInputOptions, actionCommand: Command) => {
      await executeRegistered(registry, registered, options, actionCommand)
    })
  }
}

/**
 * 注册 `describe`：输出能力描述与按命令名索引的 schema 目录。
 * @param program 根命令
 */
function registerDescribe(program: Command): void {
  const describeCommand = addGlobalOptions(program.command('describe'))
  describeCommand
    .description('输出机器可读的能力描述（命令、字段、枚举、错误码）')
    .option('--schema', '仅输出按命令名索引的 JSON Schema 目录')
    .action((options: DescribeOptions, command: Command) => {
      const startedAt = Date.now()
      const registry = createCliRegistry()
      const commands = describeCommands(registry)

      if (options.schema === true) {
        process.stdout.write(`${JSON.stringify(commandSchemaCatalog(commands), null, 2)}\n`)
        return
      }

      const globals = resolveGlobalOptions(command)
      const catalog = describeCatalog()
      const data = { ...catalog, commands }
      printResult(
        'describe',
        successResult({ data, version: 0, meta: buildMeta(globals, startedAt) }),
      )
      if (!globals.json) {
        printError(`已输出能力描述：${catalog.errorCodes.length} 个错误码，${commands.length} 条命令。`)
      }
    })
}

/**
 * 注册 `validate`：结构完整性、外键与业务不变量扫描。
 * @param program 根命令
 */
function registerValidate(program: Command): void {
  const leaf = addGlobalOptions(program.command('validate'))
  leaf.description('校验数据库完整性、外键与业务不变量').action(
    async (_options: Record<string, unknown>, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('validate', globals, startedAt, (opened) => {
        const validation = validateLedger(opened.db)
        return { data: validation, exitCode: validation.ok ? EXIT_OK : EXIT_BUSINESS }
      })
    },
  )
}

/**
 * 注册 `query`：只读 SQL，限制行数并强制 query_only。
 * @param program 根命令
 */
function registerQuery(program: Command): void {
  const leaf = addGlobalOptions(program.command('query'))
  leaf
    .description('执行只读 SQL（仅 SELECT / WITH / EXPLAIN，单语句，默认 200 行上限）')
    .requiredOption('--sql <sql>', '只读查询语句')
    .option('--limit <n>', `返回行数上限（默认 ${DEFAULT_QUERY_LIMIT}，最大 ${MAX_QUERY_LIMIT}）`)
    .action(async (options: QueryOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('query', globals, startedAt, (opened) => {
        const limit = options.limit === undefined ? undefined : Number.parseInt(options.limit, 10)
        return { data: runQuery(opened.db, { sql: options.sql, limit }) }
      })
    })
}

/**
 * 注册 `backup`：生成一致性备份。
 * @param program 根命令
 */
function registerBackup(program: Command): void {
  const leaf = addGlobalOptions(program.command('backup'))
  leaf
    .description('生成一致性备份（VACUUM INTO + 完整性检查）')
    .option('--out <dir>', '备份目录（默认 <data>/backups）')
    .action(async (options: OutOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('backup', globals, startedAt, (opened) => {
        const backupOptions = options.out === undefined ? {} : { dir: path.resolve(options.out) }
        return { data: backupLedger(opened.db, backupOptions) }
      })
    })
}

/**
 * 注册 `export`：导出数据集；`--out` 时写入 JSON 文件。
 * @param program 根命令
 */
function registerExport(program: Command): void {
  const leaf = addGlobalOptions(program.command('export'))
  leaf
    .description('导出数据集（settings 已剔除 apiKey / baseUrl / ai.enabled）')
    .option('--out <file>', '输出 JSON 文件路径；缺省仅输出数据集对象')
    .action(async (options: OutOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('export', globals, startedAt, async (opened) => {
        const exportOptions = options.out === undefined ? {} : { out: options.out }
        return { data: await exportLedger(opened.db, exportOptions) }
      })
    })
}

/**
 * 注册 `import`：从备份 JSON 导入数据集。
 * @param program 根命令
 */
function registerImport(program: Command): void {
  const leaf = addGlobalOptions(program.command('import'))
  leaf
    .description('从备份 JSON 导入数据集（单事务，失败整体回滚）')
    .requiredOption('--backup <path>', '备份 JSON 文件路径')
    .option('--mode <mode>', '导入模式：replace（默认）或 merge', 'replace')
    .action(async (options: ImportOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('import', globals, startedAt, async (opened) => {
        const mode = normalizeImportMode(options.mode)
        return {
          data: await importLedger(opened.db, {
            backupPath: path.resolve(options.backup),
            actor: CLI_ACTOR,
            mode,
          }),
        }
      })
    })
}

/**
 * 注册 `auth token|session` 认证运维子命令。
 * @param program 根命令
 */
function registerAuth(program: Command): void {
  const auth = program.command('auth').description('agent 令牌与浏览器会话认证管理')
  const token = auth.command('token').description('agent 令牌')
  const session = auth.command('session').description('浏览器会话')

  const tokenCreate = addGlobalOptions(token.command('create'))
  tokenCreate
    .description('签发新令牌；明文只在本次输出中出现一次')
    .option('--actor <actor>', '令牌代表的操作者', CLI_ACTOR)
    .option('--label <label>', '令牌标签', '')
    .option('--expires-at <iso>', '过期时间（ISO-8601）；缺省永不过期')
    .action(async (options: TokenCreateOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('auth.token.create', globals, startedAt, (opened) => ({
        data: createToken(opened.db, {
          actor: options.actor ?? CLI_ACTOR,
          label: options.label,
          expiresAt: options.expiresAt,
        }),
      }))
    })

  const tokenList = addGlobalOptions(token.command('list'))
  tokenList
    .description('列出令牌元信息（不含明文与哈希）')
    .option('--actor <actor>', '仅列出该操作者的令牌')
    .action(async (options: AuthListOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('auth.token.list', globals, startedAt, (opened) => ({
        data: { items: listTokens(opened.db, options.actor) },
      }))
    })

  const tokenRevoke = addGlobalOptions(token.command('revoke'))
  tokenRevoke
    .description('吊销一个令牌（立即生效）')
    .requiredOption('--id <id>', 'tokenId')
    .action(async (options: AuthRevokeOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('auth.token.revoke', globals, startedAt, (opened) => ({
        data: revokeToken(opened.db, options.id),
      }))
    })

  const tokenRotate = addGlobalOptions(token.command('rotate'))
  tokenRotate
    .description('轮换令牌：吊销旧令牌并签发同操作者 / 标签的新令牌')
    .requiredOption('--id <id>', '待轮换的 tokenId')
    .action(async (options: AuthRevokeOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('auth.token.rotate', globals, startedAt, (opened) => ({
        data: rotateToken(opened.db, options.id),
      }))
    })

  const sessionList = addGlobalOptions(session.command('list'))
  sessionList
    .description('列出浏览器会话元信息（不含哈希）')
    .option('--actor <actor>', '仅列出该操作者的会话')
    .action(async (options: AuthListOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('auth.session.list', globals, startedAt, (opened) => ({
        data: { items: listSessionsForCli(opened.db, options.actor) },
      }))
    })

  const sessionRevoke = addGlobalOptions(session.command('revoke'))
  sessionRevoke
    .description('吊销一个浏览器会话（立即生效）')
    .requiredOption('--id <id>', '会话 id')
    .action(async (options: AuthRevokeOptions, command: Command) => {
      const globals = resolveGlobalOptions(command)
      const startedAt = Date.now()
      await executeLocal('auth.session.revoke', globals, startedAt, (opened) => ({
        data: revokeSessionForCli(opened.db, options.id),
      }))
    })
}

/**
 * 创建 Commander 程序；不执行任何命令，便于测试直接复用。
 * @returns 已注册全局选项、领域命令与本地命令的 Commander 实例
 */
export function createProgram(): Command {
  const program = new Command()
  program.name('ledger').description('本地合同台账的 agent 命令行接口').version(CLI_VERSION)
  addGlobalOptions(program)
  program.showHelpAfterError()

  const registry = createCliRegistry()
  registerDomainCommands(program, registry)
  registerDescribe(program)
  registerValidate(program)
  registerQuery(program)
  registerBackup(program)
  registerExport(program)
  registerImport(program)
  registerAuth(program)

  return program
}

/**
 * CLI 入口：解析参数并返回进程退出码，不直接调用 `process.exit()`。
 * @param argv 不含 node 与脚本路径的参数
 * @returns 0 成功 / 1 业务失败 / 2 用法错误 / 4 未认证
 */
export async function main(argv: readonly string[]): Promise<number> {
  const program = createProgram()
  overrideExit(program)

  try {
    await program.parseAsync([...argv], { from: 'user' })
    return EXIT_OK
  } catch (error) {
    if (error instanceof CliExit) {
      return error.exitCode
    }
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
