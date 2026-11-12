import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, vacuumInto, type Database } from '../src/index.js'
import {
  contractRow,
  createTestContext,
  deliveryRow,
  disposeContext,
  paymentRow,
  seedDicts,
  type TestContext,
} from './helpers.js'

/** 读取指定表的行数。 */
function countRows(db: Database, table: string): number {
  const row = db.prepare<[], { total: number }>(`SELECT COUNT(*) AS total FROM ${table}`).get()
  return row ? row.total : 0
}

describe('VACUUM INTO 备份', () => {
  let ctx: TestContext
  let backupDb: Database | null

  beforeEach(async () => {
    ctx = await createTestContext()
    backupDb = null
    seedDicts(ctx)
    ctx.contracts.insert(contractRow({ id: 'c-backup', no: 'HT-BACKUP' }))
    ctx.payments.insert(paymentRow({ id: 'pay-backup', contractId: 'c-backup', amountCents: 300 }))
    ctx.deliveries.insert(deliveryRow({ id: 'del-backup', contractId: 'c-backup', amountCents: 200 }))
  })

  afterEach(() => {
    if (backupDb && backupDb.open) backupDb.close()
    backupDb = null
    disposeContext(ctx)
  })

  it('备份副本可独立打开、完整性检查通过且记录数一致', () => {
    const destination = path.join(ctx.dir, 'backup.db')
    vacuumInto(ctx.db, destination)

    const db = openDatabase({ file: destination, readonly: true })
    backupDb = db

    expect(String(db.pragma('integrity_check', { simple: true }))).toBe('ok')
    expect(Number(db.pragma('foreign_keys', { simple: true }))).toBe(1)
    for (const table of ['contracts', 'payments', 'deliveries', 'personnel', 'dict_categories', 'dict_items']) {
      expect({ table, total: countRows(db, table) }).toEqual({ table, total: countRows(ctx.db, table) })
    }
    expect(countRows(db, 'contracts')).toBe(1)
    const view = db
      .prepare<[string], { paid_cents: number; delivered_cents: number }>(
        'SELECT paid_cents, delivered_cents FROM v_contract_full WHERE id = ?',
      )
      .get('c-backup')
    expect(view).toEqual({ paid_cents: 300, delivered_cents: 200 })
  })
})
