/**
 * 8.3 恢复演练：备份 → 删除主库 → 校验备份 → 恢复 → 重开 → validate 零违规。
 * 断言合同/流水/交付/人员/字典计数与已付、已交付总额在恢复前后完全一致。
 */
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dispatch, type CommandResult } from '@ledger/core'
import { validateLedger } from '@ledger/cli'
import {
  backupDatabase,
  openDatabase,
  readDatasetVersion,
  restoreBackup,
  verifyBackup,
  type BackupCounts,
  type Database,
} from '@ledger/storage-sqlite'
import {
  contractInput,
  createIntegrationContext,
  expectSuccess,
  isRecord,
  readRecord,
  readString,
  type IntegrationContext,
} from './helpers.js'

/** 恢复前后对比快照。 */
interface Snapshot {
  counts: BackupCounts
  paidCents: number
  deliveredCents: number
  version: number
}

/**
 * 读取计数、派生总额与数据集版本。
 * @param db 数据库连接
 * @returns 快照
 */
function readSnapshot(db: Database): Snapshot {
  const count = (sql: string): number => {
    const row = db.prepare<[], { total: number }>(sql).get()
    return row ? row.total : 0
  }
  const totals = db
    .prepare<[], { paid: number; delivered: number }>(
      `SELECT COALESCE(SUM(paid_cents), 0) AS paid,
              COALESCE(SUM(delivered_cents), 0) AS delivered
         FROM v_contract_full`,
    )
    .get()
  return {
    counts: {
      contracts: count('SELECT COUNT(*) AS total FROM contracts'),
      payments: count('SELECT COUNT(*) AS total FROM payments'),
      deliveries: count('SELECT COUNT(*) AS total FROM deliveries'),
      personnel: count('SELECT COUNT(*) AS total FROM personnel'),
      dicts: count('SELECT COUNT(*) AS total FROM dict_items'),
    },
    paidCents: totals?.paid ?? 0,
    deliveredCents: totals?.delivered ?? 0,
    version: readDatasetVersion(db),
  }
}

/**
 * 读取命令结果中的合同 id。
 * @param result 命令结果
 * @returns 合同 id
 */
function readContractId(result: CommandResult<unknown>): string {
  const success = expectSuccess(result)
  if (!isRecord(success.data)) throw new Error('合同命令结果 data 不是对象。')
  return readString(readRecord(success.data, 'contract'), 'id')
}

describe('8.3 备份与恢复演练', () => {
  let ctx: IntegrationContext

  beforeAll(async () => {
    ctx = await createIntegrationContext()
  })

  afterAll(() => {
    ctx.dispose()
  })

  it('备份后删除主库再恢复，validate 零违规且计数与金额一致', async () => {
    let keyIndex = 0
    const write = async (
      name: string,
      input: Record<string, unknown>,
    ): Promise<CommandResult<unknown>> => {
      keyIndex += 1
      return dispatch(ctx.registry, name, input, {
        store: ctx.store,
        actor: 'restore-drill',
        transport: 'cli',
        idempotencyKey: `restore-${keyIndex}`,
      })
    }

    const first = await write(
      'contract.upsert',
      contractInput({ no: 'HT-RST-1', amountCents: 100_000 }),
    )
    const firstId = readContractId(first)
    await write('payment.record', { contractId: firstId, date: '2026-02-01', amountCents: 40_000 })
    await write('delivery.record', { contractId: firstId, date: '2026-03-01', amountCents: 30_000 })

    const second = await write(
      'contract.upsert',
      contractInput({ no: 'HT-RST-2', direction: 'purchase', amountCents: 80_000 }),
    )
    const secondId = readContractId(second)
    await write('payment.record', { contractId: secondId, date: '2026-02-02', amountCents: 20_000 })

    const before = readSnapshot(ctx.db)
    expect(before.counts.contracts).toBe(2)
    expect(before.counts.payments).toBe(2)
    expect(before.counts.deliveries).toBe(1)

    const backup = backupDatabase(ctx.db, {
      dir: path.join(ctx.dir, 'backups'),
      now: new Date('2026-05-01T00:00:00.000Z'),
    })
    expect(existsSync(backup.path)).toBe(true)
    expect(backup.bytes).toBeGreaterThan(0)

    ctx.db.close()
    rmSync(ctx.file, { force: true })
    rmSync(`${ctx.file}-wal`, { force: true })
    rmSync(`${ctx.file}-shm`, { force: true })
    expect(existsSync(ctx.file)).toBe(false)

    const verification = verifyBackup(backup.path)
    expect(verification.ok).toBe(true)
    expect(verification.integrity).toBe('ok')
    expect(verification.counts).toEqual(before.counts)

    const restored = restoreBackup(backup.path, ctx.file)
    expect(restored.path).toBe(ctx.file)
    expect(existsSync(ctx.file)).toBe(true)

    const reopened = openDatabase({ file: ctx.file })
    try {
      const validation = validateLedger(reopened)
      expect(validation.ok).toBe(true)
      expect(validation.integrity).toBe('ok')
      expect(validation.foreignKeys).toEqual([])
      expect(validation.violations).toEqual([])

      const after = readSnapshot(reopened)
      expect(after.counts).toEqual(before.counts)
      expect(after.paidCents).toBe(before.paidCents)
      expect(after.deliveredCents).toBe(before.deliveredCents)
      expect(after.version).toBe(before.version)
      expect(after.paidCents).toBe(60_000)
      expect(after.deliveredCents).toBe(30_000)
    } finally {
      reopened.close()
    }
  })
})
