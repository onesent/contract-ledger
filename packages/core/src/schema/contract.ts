/**
 * 合同 schema：新增（含默认值）、更新（除 id 外全可选）与完整记录。
 * 未知字段一律拒绝；到期日必须不早于开始日。
 */
import { z } from 'zod'
import { isoDate, isoDateTime, nonEmptyString } from './primitives.js'

/** 附件元信息（只记录元数据，不存文件内容）。 */
export const attachmentSchema = z
  .object({
    name: nonEmptyString(200),
    size: z.int().min(0, '文件大小不能为负数'),
    note: z.string().max(500).default(''),
  })
  .strict()

/** 合同状态变更日志。 */
export const statusLogSchema = z
  .object({
    id: z.uuid(),
    from: z.string().nullable(),
    to: nonEmptyString(64),
    at: isoDateTime,
    by: z.string().max(100),
  })
  .strict()

/**
 * 合同字段基线（不含默认值），供新增/更新/完整记录复用。
 * `no` 与 `counterparty` 使用 trim；编号唯一性由领域不变量按忽略大小写判断。
 */
const contractBaseShape = {
  id: z.uuid(),
  no: nonEmptyString(64),
  projectName: z.string().max(200),
  direction: z.enum(['sale', 'purchase']),
  counterparty: nonEmptyString(200),
  typeCode: nonEmptyString(64),
  statusCode: nonEmptyString(64),
  ownerId: z.uuid().nullable(),
  ownerName: z.string().max(100),
  amountCents: z.int().min(0, '合同金额不能为负数'),
  signDate: isoDate,
  startDate: isoDate,
  dueDate: isoDate,
  note: z.string().max(1000),
  attachments: z.array(attachmentSchema),
  statusChangedAt: isoDateTime.nullable(),
} as const

/** 合同新增入参：projectName / ownerName / note 缺省为空串，附件与状态变更时间可选。 */
export const contractCreateSchema = z
  .object({
    ...contractBaseShape,
    projectName: contractBaseShape.projectName.default(''),
    ownerName: contractBaseShape.ownerName.default(''),
    note: contractBaseShape.note.default(''),
    attachments: contractBaseShape.attachments.optional(),
    statusChangedAt: contractBaseShape.statusChangedAt.optional(),
  })
  .strict()
  .refine((value) => value.dueDate >= value.startDate, {
    message: '到期日不能早于开始日期',
    path: ['dueDate'],
  })

/** 合同更新入参：除 id 外全部可选；提供开始日与到期日时仍校验先后。 */
export const contractUpdateSchema = z
  .object(contractBaseShape)
  .partial()
  .required({ id: true })
  .strict()
  .refine(
    (value) => value.startDate === undefined || value.dueDate === undefined || value.dueDate >= value.startDate,
    { message: '到期日不能早于开始日期', path: ['dueDate'] },
  )

/** 合同完整记录：新增字段 + 状态日志 + 创建/更新时间。 */
export const contractSchema = z
  .object({
    ...contractBaseShape,
    attachments: contractBaseShape.attachments.optional(),
    statusLogs: z.array(statusLogSchema).optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict()
  .refine((value) => value.dueDate >= value.startDate, {
    message: '到期日不能早于开始日期',
    path: ['dueDate'],
  })

/** 合同新增入参类型。 */
export type ContractCreateInput = z.infer<typeof contractCreateSchema>
/** 合同更新入参类型。 */
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>
/** 合同完整记录类型。 */
export type Contract = z.infer<typeof contractSchema>
/** 附件元信息类型。 */
export type Attachment = z.infer<typeof attachmentSchema>
