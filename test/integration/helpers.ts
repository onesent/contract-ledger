/**
 * 跨通道集成测试助手：临时文件库、核心命令注册表、统一信封守卫与内存 MCP 客户端。
 * 所有助手只依赖各包公共出口，不复制领域逻辑。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CommandRegistry,
  ERROR_CATALOG,
  registerCoreCommands,
  type CommandResult,
  type FailureResult,
  type LedgerStore,
  type SuccessResult,
} from '@ledger/core'
import {
  createLedgerStore,
  defaultMigrationsDir,
  migrateDatabase,
  openDatabase,
  seedDefaultDictionaries,
  type Database,
} from '@ledger/storage-sqlite'

/** 独立临时库上下文；调用方必须在 afterAll/afterEach 中 dispose。 */
export interface IntegrationContext {
  readonly dir: string
  readonly file: string
  readonly db: Database
  readonly store: LedgerStore
  readonly registry: CommandRegistry
  dispose(): void
}

/**
 * 创建临时目录 + 已迁移文件库 + 默认字典 + 核心命令注册表。
 * @returns 集成上下文
 */
export async function createIntegrationContext(): Promise<IntegrationContext> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-integration-'))
  const file = path.join(dir, 'ledger.db')
  const db = openDatabase({ file })
  await migrateDatabase(db, {
    migrationsDir: defaultMigrationsDir(),
    backupDir: path.join(dir, 'backups'),
  })
  seedDefaultDictionaries(db)
  const store = createLedgerStore(db)
  const registry = new CommandRegistry()
  registerCoreCommands(registry)
  return {
    dir,
    file,
    db,
    store,
    registry,
    dispose: () => {
      if (db.open) db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** 合同构造参数。 */
export interface ContractInputOptions {
  no: string
  direction?: 'sale' | 'purchase'
  amountCents?: number
  counterparty?: string
}

/**
 * 构造 contract.upsert 的合法入参。
 * @param options 编号、方向、金额与对方
 * @returns 命令入参
 */
export function contractInput(options: ContractInputOptions): Record<string, unknown> {
  const direction = options.direction ?? 'sale'
  return {
    no: options.no,
    projectName: `${options.no} 项目`,
    direction,
    counterparty: options.counterparty ?? '集成测试客户',
    typeCode: direction === 'purchase' ? 'purchase' : 'sales',
    statusCode: 'executing',
    ownerId: null,
    amountCents: options.amountCents ?? 100_000,
    signDate: '2026-01-01',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
    note: '',
  }
}

/**
 * 断言命令成功并返回成功信封。
 * @param result 命令结果
 * @returns 成功信封
 */
export function expectSuccess<T>(result: CommandResult<T>): SuccessResult<T> {
  if (!result.ok) {
    throw new Error(`预期成功，实际失败：${result.code}（${result.message}）`)
  }
  return result
}

/**
 * 断言命令失败并返回失败信封。
 * @param result 命令结果
 * @returns 失败信封
 */
export function expectFailure<T>(result: CommandResult<T>): FailureResult {
  if (result.ok) throw new Error('预期失败，但命令返回成功。')
  return result
}

/**
 * 判断是否为普通 JSON 对象。
 * @param value 任意值
 * @returns 是否为对象
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 判断值是否为统一命令信封（成功或失败）。
 * @param value 任意值
 * @returns 是否为 CommandResult
 */
export function isCommandResult(value: unknown): value is CommandResult<unknown> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (!isRecord(value.meta)) return false
  if (value.ok) return 'data' in value && typeof value.version === 'number'
  return (
    typeof value.code === 'string' &&
    Object.hasOwn(ERROR_CATALOG, value.code) &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean'
  )
}

/**
 * 断言字段为对象并读取。
 * @param parent 父对象
 * @param field 字段名
 * @returns 字段对象
 */
export function readRecord(parent: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = parent[field]
  if (!isRecord(value)) throw new Error(`字段 ${field} 不是对象。`)
  return value
}

/**
 * 断言字段为字符串并读取。
 * @param parent 父对象
 * @param field 字段名
 * @returns 字段字符串
 */
export function readString(parent: Record<string, unknown>, field: string): string {
  const value = parent[field]
  if (typeof value !== 'string') throw new Error(`字段 ${field} 不是字符串。`)
  return value
}

/**
 * 断言字段为数字并读取。
 * @param parent 父对象
 * @param field 字段名
 * @returns 字段数字
 */
export function readNumber(parent: Record<string, unknown>, field: string): number {
  const value = parent[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`字段 ${field} 不是有限数字。`)
  }
  return value
}
