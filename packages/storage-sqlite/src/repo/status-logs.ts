import type { Selectable } from 'kysely'
import type { ContractStatusLogRepository, ContractStatusLogRow } from '@ledger/core'
import type { DB } from '../generated/db.js'
import { executeAll, executeRun, type RepoRuntime } from './runtime.js'

/** 状态日志事实表读取行。 */
export type StatusLogRecord = Selectable<DB['contract_status_logs']>

/**
 * 状态日志行 → 契约行。
 * 数据库允许 from_code 为 NULL（首条日志），契约层用空串表达“无旧值”。
 * @param row contract_status_logs 行
 */
export function toStatusLogRow(row: StatusLogRecord): ContractStatusLogRow {
  return {
    id: row.id,
    contractId: row.contract_id,
    fromCode: row.from_code ?? '',
    toCode: row.to_code,
    changedAt: row.changed_at,
    actor: row.actor,
    note: row.note,
  }
}

/**
 * SQLite 合同状态日志仓储：只追加，不提供修改与删除。
 * 删除合同由 `contract_status_logs.contract_id` 的 ON DELETE CASCADE 自动清理。
 */
export class SqliteContractStatusLogRepository implements ContractStatusLogRepository {
  constructor(private readonly runtime: RepoRuntime) {}

  listByContract(contractId: string): ContractStatusLogRow[] {
    const rows = executeAll<StatusLogRecord>(
      this.runtime,
      this.runtime.kysely
        .selectFrom('contract_status_logs')
        .selectAll()
        .where('contract_id', '=', contractId)
        .orderBy('changed_at', 'asc')
        .orderBy('id', 'asc'),
    )
    return rows.map(toStatusLogRow)
  }

  insert(row: ContractStatusLogRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely.insertInto('contract_status_logs').values({
        id: row.id,
        contract_id: row.contractId,
        from_code: row.fromCode === '' ? null : row.fromCode,
        to_code: row.toCode,
        changed_at: row.changedAt,
        actor: row.actor,
        note: row.note,
      }),
    )
  }
}
