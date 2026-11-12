import type { PaymentRepository, PaymentRow } from '@ledger/core'
import type { PaymentRecord } from './mappers.js'
import { toPaymentRow } from './mappers.js'
import { executeAll, executeRun, type RepoRuntime } from './runtime.js'

/** SQLite 资金流水仓储。 */
export class SqlitePaymentRepository implements PaymentRepository {
  constructor(private readonly runtime: RepoRuntime) {}

  getById(id: string): PaymentRow | null {
    const rows = executeAll<PaymentRecord>(
      this.runtime,
      this.runtime.kysely.selectFrom('payments').selectAll().where('id', '=', id).limit(1),
    )
    const row = rows[0]
    return row ? toPaymentRow(row) : null
  }

  listByContract(contractId: string): PaymentRow[] {
    const rows = executeAll<PaymentRecord>(
      this.runtime,
      this.runtime.kysely
        .selectFrom('payments')
        .selectAll()
        .where('contract_id', '=', contractId)
        .orderBy('date', 'asc')
        .orderBy('id', 'asc'),
    )
    return rows.map(toPaymentRow)
  }

  insert(row: PaymentRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely.insertInto('payments').values({
        id: row.id,
        contract_id: row.contractId,
        date: row.date,
        amount_cents: row.amountCents,
        method_code: row.methodCode,
        note: row.note,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      }),
    )
  }

  delete(id: string): void {
    executeRun(this.runtime, this.runtime.kysely.deleteFrom('payments').where('id', '=', id))
  }
}
