import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WriteMutation } from '@ledger/core'
import {
  captureLedgerError,
  contractRow,
  countTable,
  createTestContext,
  disposeContext,
  paymentRow,
  seedDicts,
  writeOptions,
  type TestContext,
} from './helpers.js'

describe('幂等键与重放', () => {
  let ctx: TestContext

  /** 记录一笔付款并返回支付 id。 */
  function recordPayment(id: string): () => WriteMutation<{ paymentId: string }> {
    return () => {
      ctx.payments.insert(paymentRow({ id, contractId: 'c-1', amountCents: 100 }))
      return { result: { paymentId: id } }
    }
  }

  beforeEach(async () => {
    ctx = await createTestContext()
    seedDicts(ctx)
    ctx.contracts.insert(contractRow({ id: 'c-1', no: 'HT-1', amountCents: 1000 }))
  })

  afterEach(() => {
    disposeContext(ctx)
  })

  it('相同键 + 相同指纹直接重放，不产生新行、版本或审计', async () => {
    const options = writeOptions({
      actor: 'alice',
      command: 'payment.record',
      idempotencyKey: 'k-replay',
      inputFingerprint: 'fp-1',
    })

    const first = await ctx.store.write(recordPayment('p-1'), options)
    expect(first).toEqual({ result: { paymentId: 'p-1' }, version: 1, replayed: false })

    const second = await ctx.store.write(() => {
      throw new Error('重放不应执行写函数')
    }, options)

    expect(second).toEqual({ result: { paymentId: 'p-1' }, version: 1, replayed: true })
    expect(ctx.store.getVersion()).toBe(1)
    expect(countTable(ctx.db, 'payments')).toBe(1)
    expect(countTable(ctx.db, 'idempotency_keys')).toBe(1)
    expect(countTable(ctx.db, 'audit_log')).toBe(1)
  })

  it('相同键 + 不同指纹返回 IDEMPOTENCY_KEY_REUSED', async () => {
    const options = writeOptions({
      actor: 'alice',
      command: 'payment.record',
      idempotencyKey: 'k-reuse',
      inputFingerprint: 'fp-1',
    })
    await ctx.store.write(recordPayment('p-1'), options)

    const error = await captureLedgerError(() =>
      ctx.store.write(
        recordPayment('p-2'),
        writeOptions({
          actor: 'alice',
          command: 'payment.record',
          idempotencyKey: 'k-reuse',
          inputFingerprint: 'fp-2',
        }),
      ),
    )

    expect(error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(error.details).toEqual({ storedFingerprint: 'fp-1' })
    expect(ctx.store.getVersion()).toBe(1)
    expect(countTable(ctx.db, 'payments')).toBe(1)
  })

  it('相同键不同 command 属于不同作用域，可分别执行', async () => {
    const first = await ctx.store.write(
      recordPayment('p-cmd-1'),
      writeOptions({ idempotencyKey: 'k-cmd', command: 'payment.record' }),
    )
    const second = await ctx.store.write(
      recordPayment('p-cmd-2'),
      writeOptions({ idempotencyKey: 'k-cmd', command: 'delivery.record' }),
    )

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(second.replayed).toBe(false)
    expect(countTable(ctx.db, 'payments')).toBe(2)
  })

  it('相同键不同 actor 属于不同作用域，可分别执行', async () => {
    const first = await ctx.store.write(
      recordPayment('p-actor-1'),
      writeOptions({ idempotencyKey: 'k-actor', actor: 'alice' }),
    )
    const second = await ctx.store.write(
      recordPayment('p-actor-2'),
      writeOptions({ idempotencyKey: 'k-actor', actor: 'bob' }),
    )

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(countTable(ctx.db, 'payments')).toBe(2)
  })

  it('缺少幂等键时拒绝且不开事务', async () => {
    const error = await captureLedgerError(() =>
      ctx.store.write(recordPayment('p-missing'), writeOptions({ idempotencyKey: '' })),
    )

    expect(error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(ctx.store.getVersion()).toBe(0)
    expect(countTable(ctx.db, 'payments')).toBe(0)
    expect(countTable(ctx.db, 'idempotency_keys')).toBe(0)
  })
})
