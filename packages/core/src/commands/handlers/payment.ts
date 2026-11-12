/**
 * 资金流水命令：登记、按合同查询、删除；已付金额与进度由视图实时派生。
 */
import { z } from 'zod'
import type { PaymentRow } from '../../contracts/api-shapes.js'
import { LedgerError } from '../../contracts/ledger-error.js'
import { assertPaymentWithinContract } from '../../invariants.js'
import { isoDate } from '../../schema/primitives.js'
import {
  computeView,
  invariantOrThrow,
  newId,
  nowIso,
  requireContract,
  totalPaidCents,
} from '../helpers.js'
import { defineCommand } from '../registry.js'
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  contractViewSchema,
  paymentViewSchema,
} from './shapes.js'

/** payment.record 入参。 */
const paymentRecordInput = z
  .object({
    contractId: z.uuid(),
    date: isoDate,
    amountCents: z.int().positive('收款金额必须大于 0'),
    methodCode: z.string().max(64).optional(),
    note: z.string().max(500).optional(),
  })
  .strict()

/** payment.list 入参。 */
const paymentListInput = z.object({ contractId: z.uuid() }).strict()

/** payment.delete 入参。 */
const paymentDeleteInput = z.object({ id: z.uuid() }).strict()

/** payment.record：登记一笔资金流水。 */
export const paymentRecordCommand = defineCommand({
  name: 'payment.record',
  summary: '为合同登记一笔资金流水（累计不得超过合同金额）',
  input: paymentRecordInput,
  output: z.object({ payment: paymentViewSchema, contract: contractViewSchema }).strict(),
  annotations: WRITE_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED', 'NOT_FOUND', 'PAYMENT_EXCEEDS_CONTRACT_AMOUNT'],
  handler: async (input, ctx) => {
    const contract = requireContract(ctx.store, input.contractId)
    invariantOrThrow(
      assertPaymentWithinContract(
        contract.amountCents,
        totalPaidCents(ctx.store, contract),
        input.amountCents,
      ),
    )
    const now = nowIso()
    const row: PaymentRow = {
      id: newId(),
      contractId: contract.id,
      date: input.date,
      amountCents: input.amountCents,
      methodCode: input.methodCode ?? '',
      note: input.note ?? '',
      createdAt: now,
      updatedAt: now,
    }
    ctx.store.payments.insert(row)
    return {
      data: {
        payment: row,
        contract: computeView(ctx.store, ctx.store.contracts.getById(contract.id) ?? contract),
      },
    }
  },
})

/** payment.list：按合同查询资金流水。 */
export const paymentListCommand = defineCommand({
  name: 'payment.list',
  summary: '按合同查询全部资金流水',
  input: paymentListInput,
  output: z.object({ items: z.array(paymentViewSchema) }).strict(),
  annotations: READ_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED'],
  handler: async (input, ctx) => ({
    data: { items: ctx.store.payments.listByContract(input.contractId) },
  }),
})

/** payment.delete：删除资金流水并重算合同视图。 */
export const paymentDeleteCommand = defineCommand({
  name: 'payment.delete',
  summary: '删除一笔资金流水（合同已付金额与进度自动回退）',
  input: paymentDeleteInput,
  output: z
    .object({ id: z.uuid(), contractId: z.uuid(), contract: contractViewSchema })
    .strict(),
  annotations: DESTRUCTIVE_ANNOTATIONS,
  errorCodes: ['NOT_FOUND'],
  handler: async (input, ctx) => {
    const payment = ctx.store.payments.getById(input.id)
    if (payment === null) {
      throw new LedgerError('NOT_FOUND', `资金流水不存在：${input.id}`, { id: input.id })
    }
    const contract = requireContract(ctx.store, payment.contractId)
    ctx.store.payments.delete(input.id)
    return {
      data: {
        id: input.id,
        contractId: payment.contractId,
        contract: computeView(ctx.store, contract),
      },
    }
  },
})
