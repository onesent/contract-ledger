/**
 * 只读 SQL 查询：仅允许 SELECT / WITH / EXPLAIN 单语句，强制行数上限，
 * 并通过 `PRAGMA query_only` 在数据库层兜底拒绝任何写入。
 */
import { LedgerError } from '@ledger/core'
import type { Database } from '@ledger/storage-sqlite'

/** 默认返回行数上限。 */
export const DEFAULT_QUERY_LIMIT = 200

/** 允许的最大返回行数。 */
export const MAX_QUERY_LIMIT = 1000

/** 查询入参。 */
export interface QueryInput {
  /** 单条只读 SQL。 */
  sql: string
  /** 返回行数上限；缺省 200，超过 1000 时按 1000 处理。 */
  limit?: number
}

/** 查询结果。 */
export interface QueryResult {
  /** 结果列名。 */
  columns: string[]
  /** 结果行（已按 limit 截断）。 */
  rows: unknown[]
  /** 实际返回行数。 */
  rowCount: number
  /** 原始结果是否超过 limit。 */
  truncated: boolean
  /** 本次生效的行数上限。 */
  limit: number
}

/** 只读语句允许的前缀。 */
const READ_PREFIX = /^(select|with|explain)\b/i

/**
 * 归一化行数上限：缺省 200，向下取整，夹取到 [1, 1000]。
 * @param raw 调用方传入的上限
 * @returns 生效上限
 */
export function normalizeQueryLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_QUERY_LIMIT
  const floored = Math.floor(raw)
  if (floored < 1) return 1
  return Math.min(floored, MAX_QUERY_LIMIT)
}

/**
 * 去掉末尾分号并判断是否仍含多语句分隔符。
 * 字符串字面量中的分号可能被误判，但这里采取更保守的拒绝策略。
 * @param sql 原始 SQL
 * @returns 去掉尾分号后的语句
 * @throws {LedgerError} 含多条语句
 */
function assertSingleStatement(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (trimmed === '') {
    throw new LedgerError('QUERY_REJECTED', '查询语句不能为空。')
  }
  if (trimmed.includes(';')) {
    throw new LedgerError('QUERY_REJECTED', '只允许执行单条只读语句，请移除多余的分号语句。')
  }
  return trimmed
}

/**
 * 去掉语句前导空白与注释，便于安全地判断前缀。
 * @param sql 已去尾分号的语句
 * @returns 去掉注释后的语句
 */
function stripLeadingComments(sql: string): string {
  let rest = sql.trimStart()
  for (;;) {
    if (rest.startsWith('--')) {
      const end = rest.indexOf('\n')
      if (end < 0) return ''
      rest = rest.slice(end + 1).trimStart()
      continue
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/')
      if (end < 0) return ''
      rest = rest.slice(end + 2).trimStart()
      continue
    }
    return rest
  }
}

/**
 * 执行只读 SQL。
 * @param db 数据库连接
 * @param input SQL 与行数上限
 * @returns 列名、行、截断标记
 * @throws {LedgerError} 非只读语句、多语句或不是返回结果集的语句
 */
export function runQuery(db: Database, input: QueryInput): QueryResult {
  const sql = assertSingleStatement(input.sql)
  const statementText = stripLeadingComments(sql)
  if (!READ_PREFIX.test(statementText)) {
    throw new LedgerError('QUERY_REJECTED', '只允许 SELECT / WITH / EXPLAIN 只读查询。')
  }

  const limit = normalizeQueryLimit(input.limit)
  // query_only 在数据库层兜底：即使 CTE 伪装成写语句也会被拒绝。
  db.pragma('query_only = ON')
  try {
    const statement = db.prepare<[], unknown>(statementText)
    if (!statement.reader) {
      throw new LedgerError('QUERY_REJECTED', '该语句不会返回结果集，已按只读策略拒绝。')
    }
    const columns = statement.columns().map((column) => column.name)
    const rows: unknown[] = []
    let truncated = false
    for (const row of statement.iterate()) {
      if (rows.length >= limit) {
        truncated = true
        break
      }
      rows.push(row)
    }
    return { columns, rows, rowCount: rows.length, truncated, limit }
  } finally {
    db.pragma('query_only = OFF')
  }
}
