import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LedgerError, type WriteOptions } from '@ledger/core'
import {
  SqliteContractRepository,
  SqliteDeliveryRepository,
  SqliteDictRepository,
  SqlitePaymentRepository,
  SqlitePersonnelRepository,
  createLedgerStore,
  createRepoRuntime,
  defaultMigrationsDir,
  migrateDatabase,
  openDatabase,
  type Database,
  type RepoRuntime,
  type SqliteLedgerStore,
} from '../src/index.js'
import { category, dictItem } from './fixtures.js'

// 工厂函数保持在 fixtures.ts，helpers.ts 继续对外暴露，测试可直接从任一处导入。
export * from './fixtures.js'

/** 每个测试独立的临时库上下文。 */
export interface TestContext {
  dir: string
  file: string
  db: Database
  runtime: RepoRuntime
  store: SqliteLedgerStore
  contracts: SqliteContractRepository
  payments: SqlitePaymentRepository
  deliveries: SqliteDeliveryRepository
  personnel: SqlitePersonnelRepository
  dicts: SqliteDictRepository
}

/**
 * 创建临时目录 + 文件库 + 已迁移的仓储上下文。
 * 调用方必须在 afterEach 中调用 disposeContext。
 */
export async function createTestContext(): Promise<TestContext> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-storage-'))
  const file = path.join(dir, 'ledger.db')
  const db = openDatabase({ file })
  await migrateDatabase(db, { migrationsDir: defaultMigrationsDir(), backupDir: path.join(dir, 'backups') })
  const runtime = createRepoRuntime(db)
  const repos = {
    contracts: new SqliteContractRepository(runtime),
    payments: new SqlitePaymentRepository(runtime),
    deliveries: new SqliteDeliveryRepository(runtime),
    personnel: new SqlitePersonnelRepository(runtime),
    dicts: new SqliteDictRepository(runtime),
  }
  return {
    dir,
    file,
    db,
    runtime,
    store: createLedgerStore(db, repos),
    ...repos,
  }
}

/** 关闭连接并删除临时目录。 */
export function disposeContext(ctx: TestContext): void {
  if (ctx.db.open) ctx.db.close()
  rmSync(ctx.dir, { recursive: true, force: true })
}

/** 插入测试所需的基础字典：合同类型、合同状态、付款方式、部门。 */
export function seedDicts(ctx: TestContext): void {
  ctx.dicts.insertCategory(category('cat-contract-type', 'contractType', '合同类型'))
  ctx.dicts.insertCategory(category('cat-contract-status', 'contractStatus', '合同状态'))
  ctx.dicts.insertCategory(category('cat-pay-method', 'payMethod', '付款方式'))
  ctx.dicts.insertCategory(category('cat-department', 'department', '部门'))
  ctx.dicts.insertItem(dictItem('item-type-sales', 'contractType', 'sales', '销售合同', 10))
  ctx.dicts.insertItem(dictItem('item-type-purchase', 'contractType', 'purchase', '采购合同', 20))
  ctx.dicts.insertItem(dictItem('item-status-executing', 'contractStatus', 'executing', '执行中', 10))
  ctx.dicts.insertItem(dictItem('item-status-finished', 'contractStatus', 'finished', '已完结', 20))
  ctx.dicts.insertItem(dictItem('item-pay-transfer', 'payMethod', 'transfer', '银行转账', 10))
  ctx.dicts.insertItem(dictItem('item-dept-sales', 'department', 'sales', '销售部', 10))
  ctx.dicts.insertItem(dictItem('item-dept-delivery', 'department', 'delivery', '交付部', 20))
}

/** 读取视图行的原始对象（测试断言派生列）。 */
export function readView(
  ctx: TestContext,
  id: string,
): {
  paid_cents: number
  unpaid_cents: number
  delivered_cents: number
  last_delivery_date: string | null
  funding_percent: number | null
  delivery_percent: number | null
  execution_gap_cents: number
  gap_state: string
} {
  const row = ctx.db
    .prepare<
      [string],
      {
        paid_cents: number
        unpaid_cents: number
        delivered_cents: number
        last_delivery_date: string | null
        funding_percent: number | null
        delivery_percent: number | null
        execution_gap_cents: number
        gap_state: string
      }
    >(
      'SELECT paid_cents, unpaid_cents, delivered_cents, last_delivery_date, funding_percent, delivery_percent, execution_gap_cents, gap_state FROM v_contract_full WHERE id = ?',
    )
    .get(id)
  if (!row) throw new Error(`合同视图不存在：${id}`)
  return row
}

/** 断言函数抛出包含指定片段的错误。 */
export function expectThrowMessage(fn: () => void, fragment: string): void {
  let message = ''
  try {
    fn()
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  if (message === '') {
    throw new Error(`预期抛出包含「${fragment}」的错误，但未抛出`)
  }
  if (!message.includes(fragment)) {
    throw new Error(`预期错误包含「${fragment}」，实际为「${message}」`)
  }
}

/** 生成写事务选项；默认值便于测试聚焦单个维度。 */
export function writeOptions(overrides: Partial<WriteOptions> = {}): WriteOptions {
  return {
    actor: 'tester',
    command: 'test.command',
    idempotencyKey: randomUUID(),
    inputFingerprint: 'fingerprint-1',
    transport: 'internal',
    ...overrides,
  }
}

/** 执行并捕获 LedgerError；非领域错误原样抛出。 */
export async function captureLedgerError(fn: () => Promise<unknown>): Promise<LedgerError> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof LedgerError) return error
    throw error
  }
  throw new Error('预期抛出 LedgerError，但未抛出')
}

/** 可计数的表名（测试内部使用，不接受任意字符串）。 */
export type CountableTable =
  | 'contracts'
  | 'payments'
  | 'deliveries'
  | 'personnel'
  | 'dict_items'
  | 'audit_log'
  | 'idempotency_keys'

/** 读取表行数。 */
export function countTable(db: Database, table: CountableTable): number {
  const row = db.prepare<[], { total: number }>(`SELECT COUNT(*) AS total FROM ${table}`).get()
  return row ? row.total : 0
}
