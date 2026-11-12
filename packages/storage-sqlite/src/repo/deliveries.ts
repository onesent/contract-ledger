import type { DeliveryRepository, DeliveryRow } from '@ledger/core'
import type { DeliveryRecord } from './mappers.js'
import { toDeliveryRow } from './mappers.js'
import { executeAll, executeRun, type RepoRuntime } from './runtime.js'

/** SQLite 交付明细仓储；rejected 记录同样可读，但不计入视图已交付金额。 */
export class SqliteDeliveryRepository implements DeliveryRepository {
  constructor(private readonly runtime: RepoRuntime) {}

  getById(id: string): DeliveryRow | null {
    const rows = executeAll<DeliveryRecord>(
      this.runtime,
      this.runtime.kysely.selectFrom('deliveries').selectAll().where('id', '=', id).limit(1),
    )
    const row = rows[0]
    return row ? toDeliveryRow(row) : null
  }

  listByContract(contractId: string): DeliveryRow[] {
    const rows = executeAll<DeliveryRecord>(
      this.runtime,
      this.runtime.kysely
        .selectFrom('deliveries')
        .selectAll()
        .where('contract_id', '=', contractId)
        .orderBy('date', 'asc')
        .orderBy('id', 'asc'),
    )
    return rows.map(toDeliveryRow)
  }

  insert(row: DeliveryRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely.insertInto('deliveries').values({
        id: row.id,
        contract_id: row.contractId,
        date: row.date,
        amount_cents: row.amountCents,
        quantity: row.quantity,
        unit: row.unit,
        status: row.status,
        note: row.note,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      }),
    )
  }

  delete(id: string): void {
    executeRun(this.runtime, this.runtime.kysely.deleteFrom('deliveries').where('id', '=', id))
  }
}
