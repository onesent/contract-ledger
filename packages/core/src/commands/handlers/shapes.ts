/**
 * 命令输入/输出共享 Zod 形状与安全注解常量。
 * 输出 schema 只声明对外稳定字段；未知字段由 Zod 默认剥离，兼容后续扩展。
 */
import { z } from 'zod'

/** 只读命令注解。 */
export const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

/** 普通写命令注解。 */
export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

/** 破坏性写命令注解。 */
export const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const

/** 合同方向。 */
export const directionSchema = z.enum(['sale', 'purchase'])

/** 交付验收状态。 */
export const deliveryStatusSchema = z.enum(['delivered', 'accepted', 'rejected'])

/** 资金/交付错位状态。 */
export const gapStateSchema = z.enum(['none', 'balanced', 'prepaid', 'receivable'])

/** 合同视图输出。 */
export const contractViewSchema = z.object({
  id: z.uuid(),
  no: z.string(),
  projectName: z.string(),
  direction: directionSchema,
  counterparty: z.string(),
  typeItemId: z.string(),
  typeCode: z.string(),
  typeName: z.string(),
  statusItemId: z.string(),
  statusCode: z.string(),
  statusName: z.string(),
  amountCents: z.int(),
  openingPaidCents: z.int(),
  paidCents: z.int(),
  unpaidCents: z.int(),
  receivedAmountCents: z.int(),
  openingDeliveredCents: z.int(),
  deliveredCents: z.int(),
  lastDeliveryDate: z.string().nullable(),
  fundingPercent: z.number().nullable(),
  deliveryPercent: z.number().nullable(),
  executionGapCents: z.number(),
  gapState: gapStateSchema,
  ownerId: z.uuid().nullable(),
  ownerName: z.string(),
  note: z.string(),
  signDate: z.string(),
  startDate: z.string(),
  dueDate: z.string(),
  statusChangedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** 资金流水输出。 */
export const paymentViewSchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  date: z.string(),
  amountCents: z.int(),
  methodCode: z.string(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** 交付明细输出。 */
export const deliveryViewSchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  date: z.string(),
  amountCents: z.int(),
  quantity: z.number().nullable(),
  unit: z.string(),
  status: deliveryStatusSchema,
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** 合同状态日志输出。 */
export const contractStatusLogSchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  fromCode: z.string(),
  toCode: z.string(),
  changedAt: z.string(),
  actor: z.string(),
  note: z.string(),
})

/** 人员档案输出。 */
export const personnelViewSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  deptCode: z.string(),
  deptName: z.string(),
  position: z.string(),
  phone: z.string(),
  email: z.string(),
  active: z.boolean(),
  hireDate: z.string().nullable(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** 字典分类输出。 */
export const dictCategoryViewSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  builtin: z.boolean(),
  sort: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** 字典项输出。 */
export const dictItemViewSchema = z.object({
  id: z.uuid(),
  categoryCode: z.string(),
  code: z.string(),
  name: z.string(),
  color: z.string(),
  sort: z.int(),
  enabled: z.boolean(),
  builtin: z.boolean(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** 合同视图输出类型。 */
export type ContractViewOutput = z.infer<typeof contractViewSchema>
/** 资金流水输出类型。 */
export type PaymentViewOutput = z.infer<typeof paymentViewSchema>
/** 交付明细输出类型。 */
export type DeliveryViewOutput = z.infer<typeof deliveryViewSchema>
/** 合同状态日志输出类型。 */
export type ContractStatusLogOutput = z.infer<typeof contractStatusLogSchema>
/** 人员档案输出类型。 */
export type PersonnelViewOutput = z.infer<typeof personnelViewSchema>
/** 字典分类输出类型。 */
export type DictCategoryViewOutput = z.infer<typeof dictCategoryViewSchema>
/** 字典项输出类型。 */
export type DictItemViewOutput = z.infer<typeof dictItemViewSchema>
