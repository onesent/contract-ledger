import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  backupDatabase,
  currentSchemaVersion,
  openDatabase,
  restoreBackup,
  vacuumInto,
  verifyBackup,
  type Database,
} from '../src/index.js'
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

  it('backupDatabase 生成带时间戳的备份并可通过 verifyBackup 校验', () => {
    const dir = path.join(ctx.dir, 'manual-backups')
    const result = backupDatabase(ctx.db, {
      dir,
      now: new Date('2026-05-06T07:08:09.123Z'),
    })

    expect(path.basename(result.path)).toBe('ledger-20260506-070809-123.db')
    expect(result.bytes).toBeGreaterThan(0)

    const verification = verifyBackup(result.path)
    expect(verification.ok).toBe(true)
    expect(verification.integrity).toBe('ok')
    expect(verification.counts).toEqual({
      contracts: 1,
      payments: 1,
      deliveries: 1,
      personnel: 0,
      dicts: 7,
    })
  })

  it('同一时间戳重复备份时生成不同文件名', () => {
    const dir = path.join(ctx.dir, 'collision-backups')
    const now = new Date('2026-05-06T07:08:09.123Z')
    const first = backupDatabase(ctx.db, { dir, now })
    const second = backupDatabase(ctx.db, { dir, now })

    expect(second.path).not.toBe(first.path)
    expect(existsSync(first.path)).toBe(true)
    expect(existsSync(second.path)).toBe(true)
  })

  it('备份恢复到新文件后记录数与 schema 版本一致', () => {
    const dir = path.join(ctx.dir, 'roundtrip-backups')
    const backup = backupDatabase(ctx.db, { dir })
    const target = path.join(ctx.dir, 'restored.db')

    const restored = restoreBackup(backup.path, target)
    expect(restored.bytes).toBeGreaterThan(0)

    const db = openDatabase({ file: target, readonly: true })
    backupDb = db

    expect(currentSchemaVersion(db)).toBe('1')
    expect(String(db.pragma('integrity_check', { simple: true }))).toBe('ok')
    for (const table of ['contracts', 'payments', 'deliveries', 'personnel', 'dict_categories', 'dict_items']) {
      expect({ table, total: countRows(db, table) }).toEqual({ table, total: countRows(ctx.db, table) })
    }
  })

  it('目标已存在时默认拒绝恢复，overwrite 才覆盖', () => {
    const dir = path.join(ctx.dir, 'restore-policy-backups')
    const backup = backupDatabase(ctx.db, { dir })
    const target = path.join(ctx.dir, 'existing.db')
    copyFileSync(backup.path, target)

    expect(() => restoreBackup(backup.path, target)).toThrow(/拒绝覆盖/)

    const overwritten = restoreBackup(backup.path, target, { overwrite: true })
    expect(existsSync(overwritten.path)).toBe(true)
    expect(verifyBackup(target).ok).toBe(true)
  })
})
