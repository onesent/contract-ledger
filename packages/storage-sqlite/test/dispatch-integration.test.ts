import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CommandRegistry, defineCommand, dispatch } from '@ledger/core'
import {
  contractRow,
  createTestContext,
  disposeContext,
  paymentRow,
  readView,
  seedDicts,
  type TestContext,
} from './helpers.js'

let ctx: TestContext | undefined

afterEach(() => {
  if (ctx) disposeContext(ctx)
  ctx = undefined
})

/**
 * 跨包集成：命令分发器 + SQLite 存储。
 * 锁死「async handler 必须在事务内 await」这一契约，防止提交空结果。
 */
describe('dispatch + SqliteLedgerStore', () => {
  it('async handler 的写入、版本、审计与幂等重放全部生效', async () => {
    ctx = await createTestContext()
    seedDicts(ctx)
    ctx.contracts.insert(contractRow({ id: 'c-int', no: 'HT-INT', amountCents: 1000 }))

    const registry = new CommandRegistry()
    registry.register(
      defineCommand({
        name: 'payment.record',
        summary: '登记一笔付款',
        input: z
          .object({
            paymentId: z.string().min(1),
            contractId: z.string().min(1),
            amountCents: z.int().positive(),
          })
          .strict(),
        output: z.object({ paymentId: z.string(), amountCents: z.number() }).strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        errorCodes: ['PAYMENT_EXCEEDS_CONTRACT_AMOUNT'],
        handler: async (input, context) => {
          context.store.payments.insert(
            paymentRow({
              id: input.paymentId,
              contractId: input.contractId,
              amountCents: input.amountCents,
            }),
          )
          return { data: { paymentId: input.paymentId, amountCents: input.amountCents } }
        },
      }),
    )

    const options = {
      store: ctx.store,
      actor: 'tester',
      transport: 'cli' as const,
      idempotencyKey: 'k-int-1',
    }

    const first = await dispatch(
      registry,
      'payment.record',
      { paymentId: 'p-int', contractId: 'c-int', amountCents: 400 },
      options,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    expect(first.version).toBe(1)
    expect(first.data).toEqual({ paymentId: 'p-int', amountCents: 400 })
    expect(readView(ctx, 'c-int').paid_cents).toBe(400)

    const audit = ctx.db
      .prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM audit_log')
      .get()
    expect(audit?.total).toBe(1)

    const replay = await dispatch(
      registry,
      'payment.record',
      { paymentId: 'p-int', contractId: 'c-int', amountCents: 400 },
      options,
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error(replay.message)
    expect(replay.version).toBe(1)
    expect(replay.data).toEqual({ paymentId: 'p-int', amountCents: 400 })

    const payments = ctx.db
      .prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM payments')
      .get()
    expect(payments?.total).toBe(1)
  })

  it('dry-run 经分发器不写入任何行，也不消耗幂等键', async () => {
    ctx = await createTestContext()
    seedDicts(ctx)
    ctx.contracts.insert(contractRow({ id: 'c-dry', no: 'HT-DRY', amountCents: 1000 }))

    const registry = new CommandRegistry()
    registry.register(
      defineCommand({
        name: 'payment.record',
        summary: '登记一笔付款',
        input: z.object({ paymentId: z.string(), contractId: z.string(), amountCents: z.int() }).strict(),
        output: z.object({ paymentId: z.string() }).strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        errorCodes: [],
        handler: async (input, context) => {
          context.store.payments.insert(
            paymentRow({ id: input.paymentId, contractId: input.contractId, amountCents: input.amountCents }),
          )
          return { data: { paymentId: input.paymentId }, diff: { op: 'insert' } }
        },
      }),
    )

    const dry = await dispatch(
      registry,
      'payment.record',
      { paymentId: 'p-dry', contractId: 'c-dry', amountCents: 100 },
      { store: ctx.store, actor: 'tester', transport: 'cli', idempotencyKey: 'k-dry', dryRun: true },
    )
    expect(dry.ok).toBe(true)
    if (!dry.ok) throw new Error(dry.message)
    expect(dry.version).toBe(0)
    expect(dry.diff).toEqual({ op: 'insert' })
    expect(readView(ctx, 'c-dry').paid_cents).toBe(0)

    const real = await dispatch(
      registry,
      'payment.record',
      { paymentId: 'p-dry', contractId: 'c-dry', amountCents: 100 },
      { store: ctx.store, actor: 'tester', transport: 'cli', idempotencyKey: 'k-dry' },
    )
    expect(real.ok).toBe(true)
    if (!real.ok) throw new Error(real.message)
    expect(real.version).toBe(1)
    expect(readView(ctx, 'c-dry').paid_cents).toBe(100)
  })
})
