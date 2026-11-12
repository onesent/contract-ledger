/**
 * 资金流水 schema：金额必须为正整数分，日期为业务日期。
 */
import { z } from 'zod'
import { isoDate } from './primitives.js'

/** 资金流水入参。 */
export const paymentSchema = z
  .object({
    contractId: z.uuid(),
    date: isoDate,
    amountCents: z.int().positive('收款金额必须大于 0'),
    note: z.string().max(500).default(''),
  })
  .strict()

/** 资金流水入参类型。 */
export type PaymentInput = z.infer<typeof paymentSchema>
