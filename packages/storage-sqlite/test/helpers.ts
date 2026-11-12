import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  ContractRow,
  DeliveryRow,
  DictCategoryRow,
  DictItemRow,
  PaymentRow,
  PersonnelRow,
} from '@ledger/core'
import {
  SqliteContractRepository,
  SqliteDeliveryRepository,
  SqliteDictRepository,
  SqlitePaymentRepository,
  SqlitePersonnelRepository,
  createRepoRuntime,
  defaultMigrationsDir,
  migrateDatabase,
  openDatabase,
  type Database,
  type RepoRuntime,
} from '../src/index.js'

/** 测试固定时间戳。 */
export const NOW = '2026-01-01T00:00:00.000Z'

/** 每个测试独立的临时库上下文。 */
export interface TestContext {
  dir: string
  file: string
  db: Database
  runtime: RepoRuntime
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
  return {
    dir,
    file,
    db,
    runtime,
    contracts: new SqliteContractRepository(runtime),
    payments: new SqlitePaymentRepository(runtime),
    deliveries: new SqliteDeliveryRepository(runtime),
    personnel: new SqlitePersonnelRepository(runtime),
    dicts: new SqliteDictRepository(runtime),
  }
}

/** 关闭连接并删除临时目录。 */
export function disposeContext(ctx: TestContext): void {
  if (ctx.db.open) ctx.db.close()
  rmSync(ctx.dir, { recursive: true, force: true })
}

/** 字典分类工厂。 */
export function category(id: string, code: string, name: string, sort = 0): DictCategoryRow {
  return { id, code, name, builtin: true, sort, createdAt: NOW, updatedAt: NOW }
}

/** 字典项工厂。 */
export function dictItem(
  id: string,
  categoryCode: string,
  code: string,
  name: string,
  sort = 0,
): DictItemRow {
  return {
    id,
    categoryCode,
    code,
    name,
    color: '',
    sort,
    enabled: true,
    builtin: false,
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
  }
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

/** 人员工厂。 */
export function personnelRow(overrides: Partial<PersonnelRow> = {}): PersonnelRow {
  return {
    id: 'person-1',
    code: 'YG-001',
    name: '张伟',
    deptCode: 'sales',
    deptName: '',
    position: '销售经理',
    phone: '13800000001',
    email: 'zhangwei@example.com',
    active: true,
    hireDate: '2021-03-01',
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** 合同工厂：派生字段由视图计算，插入前填 0 占位。 */
export function contractRow(overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    id: 'contract-1',
    no: 'HT-001',
    projectName: '示例项目',
    direction: 'sale',
    counterparty: '示例客户',
    typeItemId: 'item-type-sales',
    typeCode: 'sales',
    typeName: '销售合同',
    statusItemId: 'item-status-executing',
    statusCode: 'executing',
    statusName: '执行中',
    amountCents: 10000,
    openingPaidCents: 0,
    paidCents: 0,
    unpaidCents: 10000,
    receivedAmountCents: 0,
    openingDeliveredCents: 0,
    deliveredCents: 0,
    lastDeliveryDate: null,
    fundingPercent: 0,
    deliveryPercent: 0,
    executionGapCents: 0,
    gapState: 'none',
    ownerId: null,
    ownerName: '',
    note: '',
    signDate: '2026-01-01',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
    statusChangedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** 资金流水工厂。 */
export function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'payment-1',
    contractId: 'contract-1',
    date: '2026-02-01',
    amountCents: 1000,
    methodCode: 'transfer',
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** 交付明细工厂。 */
export function deliveryRow(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: 'delivery-1',
    contractId: 'contract-1',
    date: '2026-03-01',
    amountCents: 1000,
    quantity: null,
    unit: '',
    status: 'delivered',
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
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
