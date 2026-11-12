/**
 * 交付明细命令：登记、按合同查询、删除。
 * 验收驳回（rejected）明细保留但绝不计入已交付金额。
 */
import { z } from 'zod'
import type { DeliveryRow } from '../../contracts/api-shapes.js'
import { LedgerError } from '../../contracts/ledger-error.js'
import { assertDeliveryWithinContract } from '../../invariants.js'
import { isoDate } from '../../schema/primitives.js'
import {
  computeView,
  invariantOrThrow,
  newId,
  nowIso,
  requireContract,
  totalDeliveredCents,
} from '../helpers.js'
import { defineCommand } from '../registry.js'
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  contractViewSchema,
  deliveryStatusSchema,
  deliveryViewSchema,
} from './shapes.js'

/** delivery.record 入参。 */
const deliveryRecordInput = z
  .object({
    contractId: z.uuid(),
    date: isoDate,
    amountCents: z.int().positive('交付金额必须大于 0'),
    quantity: z.number().finite().positive('数量必须大于 0').nullable().optional(),
    unit: z.string().max(20).optional(),
    status: deliveryStatusSchema.default('delivered'),
    note: z.string().max(500).optional(),
  })
  .strict()

/** delivery.list 入参。 */
const deliveryListInput = z.object({ contractId: z.uuid() }).strict()

/** delivery.delete 入参。 */
const deliveryDeleteInput = z.object({ id: z.uuid() }).strict()

/** delivery.record：登记一条交付执行明细。 */
export const deliveryRecordCommand = defineCommand({
  name: 'delivery.record',
  summary: '为合同登记一条交付明细（验收驳回不计入已交付金额）',
  input: deliveryRecordInput,
  output: z.object({ delivery: deliveryViewSchema, contract: contractViewSchema }).strict(),
  annotations: WRITE_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED', 'NOT_FOUND', 'DELIVERY_EXCEEDS_CONTRACT_AMOUNT'],
  handler: async (input, ctx) => {
    const contract = requireContract(ctx.store, input.contractId)
    if (input.status !== 'rejected') {
      invariantOrThrow(
        assertDeliveryWithinContract(
          contract.amountCents,
          totalDeliveredCents(ctx.store, contract),
          input.amountCents,
        ),
      )
    }
    const now = nowIso()
    const row: DeliveryRow = {
      id: newId(),
      contractId: contract.id,
      date: input.date,
      amountCents: input.amountCents,
      quantity: input.quantity ?? null,
      unit: input.unit ?? '',
      status: input.status,
      note: input.note ?? '',
      createdAt: now,
      updatedAt: now,
    }
    ctx.store.deliveries.insert(row)
    return {
      data: {
        delivery: row,
        contract: computeView(ctx.store, ctx.store.contracts.getById(contract.id) ?? contract),
      },
    }
  },
})

/** delivery.list：按合同查询交付明细。 */
export const deliveryListCommand = defineCommand({
  name: 'delivery.list',
  summary: '按合同查询全部交付明细（含验收驳回记录）',
  input: deliveryListInput,
  output: z.object({ items: z.array(deliveryViewSchema) }).strict(),
  annotations: READ_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED'],
  handler: async (input, ctx) => ({
    data: { items: ctx.store.deliveries.listByContract(input.contractId) },
  }),
})

/** delivery.delete：删除交付明细并重算合同视图。 */
export const deliveryDeleteCommand = defineCommand({
  name: 'delivery.delete',
  summary: '删除一条交付明细（已交付金额与最后交付日自动重算）',
  input: deliveryDeleteInput,
  output: z
    .object({ id: z.uuid(), contractId: z.uuid(), contract: contractViewSchema })
    .strict(),
  annotations: DESTRUCTIVE_ANNOTATIONS,
  errorCodes: ['NOT_FOUND'],
  handler: async (input, ctx) => {
    const delivery = ctx.store.deliveries.getById(input.id)
    if (delivery === null) {
      throw new LedgerError('NOT_FOUND', `交付明细不存在：${input.id}`, { id: input.id })
    }
    const contract = requireContract(ctx.store, delivery.contractId)
    ctx.store.deliveries.delete(input.id)
    return {
      data: {
        id: input.id,
        contractId: delivery.contractId,
        contract: computeView(ctx.store, contract),
      },
    }
  },
})
