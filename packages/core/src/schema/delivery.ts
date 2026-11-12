/**
 * 交付执行明细 schema：金额必须为正整数分；数量/单位仅作描述。
 * rejected（验收驳回）明细不计入已交付金额，但保留供追溯。
 */
import { z } from 'zod'
import { isoDate } from './primitives.js'

/** 交付验收状态枚举。 */
export const deliveryStatusSchema = z.enum(['delivered', 'accepted', 'rejected'])

/** 交付明细入参。 */
export const deliverySchema = z
  .object({
    contractId: z.uuid(),
    date: isoDate,
    amountCents: z.int().positive('交付金额必须大于 0'),
    quantity: z.number().finite().positive('数量必须大于 0').nullable(),
    unit: z.string().max(20).default(''),
    status: deliveryStatusSchema,
    note: z.string().max(500).default(''),
  })
  .strict()

/** 交付明细入参类型。 */
export type DeliveryInput = z.infer<typeof deliverySchema>
