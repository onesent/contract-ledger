import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../src/index.js'
import {
  captureLedgerError,
  contractRow,
  countTable,
  createTestContext,
  disposeContext,
  paymentRow,
  readView,
  seedDicts,
  writeOptions,
  type TestContext,
} from './helpers.js'

describe('版本化写事务', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
    seedDicts(ctx)
    ctx.contracts.insert(contractRow({ id: 'c-1', no: 'HT-1', amountCents: 1000 }))
  })

  afterEach(() => {
    disposeContext(ctx)
  })

  it('超付通过 store 被触发器拒绝并回滚', async () => {
    const error = await captureLedgerError(() =>
      ctx.store.write(
        () => ({
          result: ctx.payments.insert(
            paymentRow({ id: 'p-over', contractId: 'c-1', amountCents: 2000 }),
          ),
        }),
        writeOptions({ idempotencyKey: 'k-over' }),
      ),
    )

    expect(error.code).toBe('PAYMENT_EXCEEDS_CONTRACT_AMOUNT')
    expect(ctx.store.getVersion()).toBe(0)
    expect(countTable(ctx.db, 'payments')).toBe(0)
    expect(countTable(ctx.db, 'idempotency_keys')).toBe(0)
    expect(countTable(ctx.db, 'audit_log')).toBe(0)
  })

  it('合同降额到低于已付金额被拒绝', async () => {
    ctx.payments.insert(paymentRow({ id: 'p-base', contractId: 'c-1', amountCents: 600 }))
    const current = ctx.contracts.getById('c-1')
    if (!current) throw new Error('合同应存在')

    const error = await captureLedgerError(() =>
      ctx.store.write(
        () => ({ result: ctx.contracts.update({ ...current, amountCents: 500 }) }),
        writeOptions(),
      ),
    )

    expect(error.code).toBe('AMOUNT_BELOW_PAID')
    expect(ctx.store.getVersion()).toBe(0)
  })

  it('删除流水后视图派生已付金额回退', async () => {
    const first = await ctx.store.write(
      () => {
        ctx.payments.insert(paymentRow({ id: 'p-del', contractId: 'c-1', amountCents: 400 }))
        return { result: { ok: true } }
      },
      writeOptions(),
    )
    expect(first.version).toBe(1)
    expect(readView(ctx, 'c-1').paid_cents).toBe(400)

    const second = await ctx.store.write(
      () => {
        ctx.payments.delete('p-del')
        return { result: { ok: true } }
      },
      writeOptions(),
    )
    expect(second.version).toBe(2)
    expect(readView(ctx, 'c-1').paid_cents).toBe(0)
  })

  it('写函数抛错时不留下部分写入且版本不变', async () => {
    await expect(
      ctx.store.write(
        () => {
          ctx.payments.insert(paymentRow({ id: 'p-throw', contractId: 'c-1', amountCents: 100 }))
          throw new Error('handler boom')
        },
        writeOptions(),
      ),
    ).rejects.toThrow('handler boom')

    expect(ctx.store.getVersion()).toBe(0)
    expect(countTable(ctx.db, 'payments')).toBe(0)
    expect(countTable(ctx.db, 'idempotency_keys')).toBe(0)
    expect(countTable(ctx.db, 'audit_log')).toBe(0)
  })

  it('expectedVersion 不匹配返回 STALE_WRITE，匹配则成功', async () => {
    const first = await ctx.store.write(
      () => {
        ctx.payments.insert(paymentRow({ id: 'p-1', contractId: 'c-1', amountCents: 100 }))
        return { result: { ok: true } }
      },
      writeOptions({ expectedVersion: 0 }),
    )
    expect(first.version).toBe(1)

    const stale = await captureLedgerError(() =>
      ctx.store.write(
        () => {
          ctx.payments.insert(paymentRow({ id: 'p-2', contractId: 'c-1', amountCents: 100 }))
          return { result: { ok: true } }
        },
        writeOptions({ expectedVersion: 0 }),
      ),
    )
    expect(stale.code).toBe('STALE_WRITE')
    expect(stale.details).toEqual({ currentVersion: 1 })
    expect(countTable(ctx.db, 'payments')).toBe(1)

    const second = await ctx.store.write(
      () => {
        ctx.payments.insert(paymentRow({ id: 'p-3', contractId: 'c-1', amountCents: 100 }))
        return { result: { ok: true } }
      },
      writeOptions({ expectedVersion: 1 }),
    )
    expect(second.version).toBe(2)
  })

  it('dry-run 返回 diff 但不写版本、行、幂等与审计', async () => {
    const result = await ctx.store.write(
      () => {
        ctx.payments.insert(paymentRow({ id: 'p-dry', contractId: 'c-1', amountCents: 100 }))
        return { result: { dry: true }, diff: { op: 'insert', entity: 'payments' } }
      },
      writeOptions({ dryRun: true, idempotencyKey: 'k-dry' }),
    )

    expect(result).toEqual({
      result: { dry: true },
      version: 0,
      diff: { op: 'insert', entity: 'payments' },
      replayed: false,
    })
    expect(ctx.store.getVersion()).toBe(0)
    expect(countTable(ctx.db, 'payments')).toBe(0)
    expect(countTable(ctx.db, 'idempotency_keys')).toBe(0)
    expect(countTable(ctx.db, 'audit_log')).toBe(0)

    // dry-run 不占用幂等键：同一键正式执行仍应写入。
    const real = await ctx.store.write(
      () => {
        ctx.payments.insert(paymentRow({ id: 'p-dry', contractId: 'c-1', amountCents: 100 }))
        return { result: { dry: true } }
      },
      writeOptions({ idempotencyKey: 'k-dry' }),
    )
    expect(real.version).toBe(1)
    expect(countTable(ctx.db, 'payments')).toBe(1)
  })

  it('数据库被其他写事务占用时映射为 DB_BUSY', async () => {
    let other: Database | null = null
    try {
      other = openDatabase({ file: ctx.file })
      other.exec('BEGIN IMMEDIATE')
      ctx.db.pragma('busy_timeout = 0')

      const error = await captureLedgerError(() =>
        ctx.store.write(
          () => {
            ctx.payments.insert(paymentRow({ id: 'p-busy', contractId: 'c-1', amountCents: 100 }))
            return { result: { ok: true } }
          },
          writeOptions(),
        ),
      )
      expect(error.code).toBe('DB_BUSY')
      expect(error.details).toEqual({ retryable: true })
    } finally {
      ctx.db.pragma('busy_timeout = 5000')
      if (other) {
        if (other.inTransaction) other.exec('ROLLBACK')
        other.close()
      }
    }
    expect(ctx.store.getVersion()).toBe(0)
  })
})
