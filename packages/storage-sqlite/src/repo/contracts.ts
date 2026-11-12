import type { ContractListQuery, ContractRepository, ContractRow } from '@ledger/core'
import type { ContractInsert, ContractViewRecord } from './mappers.js'
import { getContractView, listContractViews } from '../views.js'
import { toContractRow } from './mappers.js'
import { executeAll, executeRun, type RepoRuntime } from './runtime.js'

/**
 * SQLite 合同仓储。
 *
 * 读操作统一走 `v_contract_full`，一次查询即可拿到字典名称与派生金额；
 * 写操作只触碰 `contracts` 事实表，派生列永不落库。
 */
export class SqliteContractRepository implements ContractRepository {
  constructor(private readonly runtime: RepoRuntime) {}

  getById(id: string): ContractRow | null {
    return getContractView(this.runtime, id)
  }

  getByNo(no: string): ContractRow | null {
    const rows = executeAll<ContractViewRecord>(
      this.runtime,
      this.runtime.kysely
        .selectFrom('v_contract_full')
        .selectAll()
        .where('no', '=', no)
        .limit(1),
    )
    const row = rows[0]
    return row ? toContractRow(row) : null
  }

  list(query: ContractListQuery = {}): ContractRow[] {
    return listContractViews(this.runtime, query)
  }

  insert(row: ContractRow): void {
    const values: ContractInsert = {
      id: row.id,
      no: row.no,
      project_name: row.projectName,
      direction: row.direction,
      counterparty: row.counterparty,
      type_item_id: row.typeItemId,
      status_item_id: row.statusItemId,
      amount_cents: row.amountCents,
      opening_paid_cents: row.openingPaidCents,
      opening_delivered_cents: row.openingDeliveredCents,
      sign_date: row.signDate,
      start_date: row.startDate,
      due_date: row.dueDate,
      owner_id: row.ownerId,
      owner_name: row.ownerName,
      note: row.note,
      status_changed_at: row.statusChangedAt,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      attachments_json: '[]',
    }
    executeRun(this.runtime, this.runtime.kysely.insertInto('contracts').values(values))
  }

  update(row: ContractRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely
        .updateTable('contracts')
        .set({
          no: row.no,
          project_name: row.projectName,
          direction: row.direction,
          counterparty: row.counterparty,
          type_item_id: row.typeItemId,
          status_item_id: row.statusItemId,
          amount_cents: row.amountCents,
          opening_paid_cents: row.openingPaidCents,
          opening_delivered_cents: row.openingDeliveredCents,
          sign_date: row.signDate,
          start_date: row.startDate,
          due_date: row.dueDate,
          owner_id: row.ownerId,
          owner_name: row.ownerName,
          note: row.note,
          status_changed_at: row.statusChangedAt,
          updated_at: row.updatedAt,
        })
        .where('id', '=', row.id),
    )
  }

  delete(id: string): void {
    executeRun(this.runtime, this.runtime.kysely.deleteFrom('contracts').where('id', '=', id))
  }
}
