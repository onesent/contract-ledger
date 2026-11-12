/**
 * 本地库校验：SQLite 结构完整性 + 外键 + 业务不变量扫描。
 *
 * 业务扫描覆盖四类历史数据质量问题：
 * 1. 合同金额低于已付/已交付（触发器理论上阻止，但旧库导入可能绕过）；
 * 2. 合同编号忽略大小写后重复（SQLite UNIQUE 默认区分大小写）；
 * 3. 执行中的合同仍引用已离职负责人；
 * 4. 验收驳回的交付明细指向不存在的合同（旧库关闭外键时可能产生）。
 */
import type { Database } from '@ledger/storage-sqlite'

/** 单条业务违规。 */
export interface ValidationViolation {
  /** 稳定问题码，便于脚本按类型过滤。 */
  code: string
  /** 违规实体：contract / delivery / personnel。 */
  entity: string
  /** 实体主键（重复编号时为规范化后的编号）。 */
  id: string
  /** 面向人的中文说明。 */
  message: string
}

/** 校验结果；`ok` 为结构、外键与业务扫描全部通过。 */
export interface LedgerValidation {
  ok: boolean
  /** `PRAGMA integrity_check` 的输出；正常为 `ok`。 */
  integrity: string
  /** `PRAGMA foreign_key_check` 的原始行。 */
  foreignKeys: unknown[]
  /** 业务不变量违规列表。 */
  violations: ValidationViolation[]
}

/** 金额越界行。 */
interface AmountRow {
  id: string
  no: string
  amount_cents: number
  paid_cents: number
  delivered_cents: number
}

/** 重复编号行。 */
interface DuplicateNoRow {
  normalized_no: string
  total: number
}

/** 离职负责人引用行。 */
interface InactiveOwnerRow {
  id: string
  no: string
  owner_name: string
}

/** 孤立驳回交付行。 */
interface OrphanDeliveryRow {
  id: string
}

/** 终态合同不再要求负责人在职：历史合同保留离职快照属于正常数据。 */
const TERMINAL_STATUS_CODES = ['finished', 'terminated'] as const

/** 判断值是否为普通 JSON 对象（排除 null 与数组）。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 读取 `PRAGMA integrity_check` 并统一成字符串；多行问题用换行连接。
 * @param db 数据库连接
 * @returns 完整性检查结果
 */
function readIntegrity(db: Database): string {
  const rows = db.pragma('integrity_check')
  if (Array.isArray(rows)) {
    const lines: string[] = []
    for (const row of rows) {
      if (isPlainRecord(row)) {
        const value = row['integrity_check']
        if (typeof value === 'string') lines.push(value)
      }
    }
    if (lines.length > 0) return lines.join('\n')
  }
  const simple = db.pragma('integrity_check', { simple: true })
  return typeof simple === 'string' ? simple : String(simple)
}

/** 合同表的 CHECK 失败：旧备份刻意保留「到期日早于开始日」等历史异常。 */
const CHECK_CONSTRAINT_FAILURE = /^CHECK constraint failed in contracts$/

/**
 * 判断完整性结果是否只有业务约束问题。
 *
 * 旧备份导入会刻意保留「到期日早于开始日」等历史异常（导入时临时关闭 CHECK），
 * 这类记录会让 `integrity_check` 报 `CHECK constraint failed`，但数据页与索引仍然健康。
 * 真正的结构损坏（页损坏、索引不一致等）会包含其它消息，从而判定为不健康。
 * @param integrity integrity_check 原始结果
 * @returns 结构是否健康
 */
function isStructurallyHealthy(integrity: string): boolean {
  if (integrity.trim() === 'ok') return true
  const lines = integrity
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.length > 0 && lines.every((line) => CHECK_CONSTRAINT_FAILURE.test(line))
}

/**
 * 读取 `PRAGMA foreign_key_check` 的原始行。
 * @param db 数据库连接
 * @returns 外键违规行数组
 */
function readForeignKeys(db: Database): unknown[] {
  const raw = db.pragma('foreign_key_check')
  return Array.isArray(raw) ? raw : []
}

/**
 * 扫描合同金额是否低于已付/已交付（以视图口径为准）。
 * @param db 数据库连接
 * @returns 违规列表
 */
function scanAmounts(db: Database): ValidationViolation[] {
  const rows = db
    .prepare<[], AmountRow>(
      `SELECT id, no, amount_cents, paid_cents, delivered_cents
       FROM v_contract_full
       WHERE paid_cents > amount_cents OR delivered_cents > amount_cents
       ORDER BY no ASC`,
    )
    .all()
  const violations: ValidationViolation[] = []
  for (const row of rows) {
    if (row.paid_cents > row.amount_cents) {
      violations.push({
        code: 'AMOUNT_BELOW_PAID',
        entity: 'contract',
        id: row.id,
        message: `合同 ${row.no} 的金额 ${row.amount_cents} 分低于已付 ${row.paid_cents} 分。`,
      })
    }
    if (row.delivered_cents > row.amount_cents) {
      violations.push({
        code: 'AMOUNT_BELOW_DELIVERED',
        entity: 'contract',
        id: row.id,
        message: `合同 ${row.no} 的金额 ${row.amount_cents} 分低于已交付 ${row.delivered_cents} 分。`,
      })
    }
  }
  return violations
}

/**
 * 扫描忽略大小写后的重复合同编号。
 * @param db 数据库连接
 * @returns 违规列表
 */
function scanDuplicateNos(db: Database): ValidationViolation[] {
  const rows = db
    .prepare<[], DuplicateNoRow>(
      `SELECT lower(no) AS normalized_no, COUNT(*) AS total
       FROM contracts
       GROUP BY lower(no)
       HAVING COUNT(*) > 1
       ORDER BY normalized_no ASC`,
    )
    .all()
  return rows.map((row) => ({
    code: 'DUPLICATE_NO',
    entity: 'contract',
    id: row.normalized_no,
    message: `合同编号忽略大小写后重复：${row.normalized_no}（共 ${row.total} 条）。`,
  }))
}

/**
 * 扫描执行中合同引用的已离职负责人。
 * @param db 数据库连接
 * @returns 违规列表
 */
function scanInactiveOwners(db: Database): ValidationViolation[] {
  const terminal = TERMINAL_STATUS_CODES.map((code) => `'${code}'`).join(', ')
  const rows = db
    .prepare<[], InactiveOwnerRow>(
      `SELECT c.id AS id, c.no AS no, p.name AS owner_name
       FROM contracts c
       JOIN personnel p ON p.id = c.owner_id
       LEFT JOIN dict_items si ON si.id = c.status_item_id
       WHERE p.active = 0 AND COALESCE(si.code, '') NOT IN (${terminal})
       ORDER BY c.no ASC`,
    )
    .all()
  return rows.map((row) => ({
    code: 'OWNER_INACTIVE',
    entity: 'contract',
    id: row.id,
    message: `合同 ${row.no} 的负责人 ${row.owner_name} 已离职，需先转交。`,
  }))
}

/**
 * 扫描指向不存在合同的验收驳回交付明细（旧库外键关闭时可能残留）。
 * @param db 数据库连接
 * @returns 违规列表
 */
function scanRejectedDeliveries(db: Database): ValidationViolation[] {
  const rows = db
    .prepare<[], OrphanDeliveryRow>(
      `SELECT d.id AS id
       FROM deliveries d
       LEFT JOIN contracts c ON c.id = d.contract_id
       WHERE d.status = 'rejected' AND c.id IS NULL
       ORDER BY d.id ASC`,
    )
    .all()
  return rows.map((row) => ({
    code: 'REJECTED_DELIVERY_LINKED',
    entity: 'delivery',
    id: row.id,
    message: `验收驳回的交付明细 ${row.id} 未关联到有效合同。`,
  }))
}

/**
 * 执行完整校验：结构完整性、外键与业务不变量。
 * @param db 数据库连接
 * @returns 校验结果（不抛错；问题以 violations 呈现）
 */
export function validateLedger(db: Database): LedgerValidation {
  const integrity = readIntegrity(db)
  const foreignKeys = readForeignKeys(db)
  const violations: ValidationViolation[] = [
    ...scanAmounts(db),
    ...scanDuplicateNos(db),
    ...scanInactiveOwners(db),
    ...scanRejectedDeliveries(db),
  ]
  return {
    ok: isStructurallyHealthy(integrity) && foreignKeys.length === 0 && violations.length === 0,
    integrity,
    foreignKeys,
    violations,
  }
}
