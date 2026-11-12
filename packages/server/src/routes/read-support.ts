/**
 * 只读路由支撑：数据库直读关联集合、合同排序与查询参数辅助。
 */
import type { ContractRow, DeliveryRow, PaymentRow } from '@ledger/core'
import type { Database } from '@ledger/storage-sqlite'
import type { Context } from 'hono'
import type { AppEnv, AppOptions } from '../types.js'

/** 默认每页条数。 */
export const DEFAULT_PAGE_SIZE = 20

/** 每页最大条数。 */
export const MAX_PAGE_SIZE = 200

/** 支持排序的合同字段。 */
export const SORT_FIELDS: ReadonlySet<string> = new Set([
  'no',
  'counterparty',
  'amountCents',
  'unpaidCents',
  'dueDate',
  'signDate',
  'updatedAt',
  'fundingPercent',
])

/** 数据库支付行。 */
interface PaymentDbRow {
  id: string
  contract_id: string
  date: string
  amount_cents: number
  method_code: string
  note: string
  created_at: string
  updated_at: string
}

/** 数据库交付行。 */
interface DeliveryDbRow {
  id: string
  contract_id: string
  date: string
  amount_cents: number
  quantity: number | null
  unit: string
  status: string
  note: string
  created_at: string
  updated_at: string
}

/**
 * 读取全部资金流水。
 * @param db 数据库连接
 * @returns 按日期升序的流水行
 */
export function listAllPayments(db: Database): PaymentRow[] {
  return db
    .prepare<[], PaymentDbRow>(
      `SELECT id, contract_id, date, amount_cents, method_code, note, created_at, updated_at
       FROM payments ORDER BY date ASC, id ASC`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      contractId: row.contract_id,
      date: row.date,
      amountCents: row.amount_cents,
      methodCode: row.method_code,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
}

/**
 * 读取全部交付明细。
 * @param db 数据库连接
 * @returns 按日期升序的交付行
 */
export function listAllDeliveries(db: Database): DeliveryRow[] {
  return db
    .prepare<[], DeliveryDbRow>(
      `SELECT id, contract_id, date, amount_cents, quantity, unit, status, note, created_at, updated_at
       FROM deliveries ORDER BY date ASC, id ASC`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      contractId: row.contract_id,
      date: row.date,
      amountCents: row.amount_cents,
      quantity: row.quantity,
      unit: row.unit,
      status: row.status === 'accepted' || row.status === 'rejected' ? row.status : 'delivered',
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
}

/**
 * 合同排序比较器。
 * @param field 排序字段
 * @returns 比较函数
 */
export function contractSorter(field: string): (a: ContractRow, b: ContractRow) => number {
  switch (field) {
    case 'no':
      return (a, b) => a.no.localeCompare(b.no, 'zh')
    case 'counterparty':
      return (a, b) => a.counterparty.localeCompare(b.counterparty, 'zh')
    case 'amountCents':
      return (a, b) => a.amountCents - b.amountCents
    case 'unpaidCents':
      return (a, b) => a.unpaidCents - b.unpaidCents
    case 'dueDate':
      return (a, b) => a.dueDate.localeCompare(b.dueDate)
    case 'signDate':
      return (a, b) => a.signDate.localeCompare(b.signDate)
    case 'fundingPercent':
      return (a, b) => (a.fundingPercent ?? -1) - (b.fundingPercent ?? -1)
    default:
      return (a, b) => a.updatedAt.localeCompare(b.updatedAt)
  }
}

/**
 * 读取并校验方向查询参数。
 * @param raw 原始值
 * @returns 方向；非法返回 null
 */
export function readDirection(raw: string | undefined): 'sale' | 'purchase' | undefined | null {
  if (raw === undefined || raw === '') return undefined
  if (raw === 'sale' || raw === 'purchase') return raw
  return null
}

/**
 * 设置数据集版本 ETag。
 * @param c Hono 上下文
 * @param options 应用配置
 */
export function setVersionEtag(c: Context<AppEnv>, options: AppOptions): void {
  c.header('ETag', `"v${options.store.getVersion()}"`)
}
