/**
 * 合同命令：新增/更新、读取详情、分页列表、删除与状态日志查询。
 * 所有写入都经分发器事务执行，处理器只调用 store 仓储。
 */
import { z } from 'zod'
import type { ContractRow, ContractView } from '../../contracts/api-shapes.js'
import { LedgerError } from '../../contracts/ledger-error.js'
import type { ContractListQuery } from '../../contracts/store-port.js'
import {
  assertAmountAtLeastCommitted,
  assertContractNoUnique,
  assertDateOrder,
  assertDirectionChangeAllowed,
} from '../../invariants.js'
import { isoDate, isoDateTime, nonEmptyString } from '../../schema/primitives.js'
import {
  assertOwnerActive,
  computeView,
  invariantOrThrow,
  newId,
  nowIso,
  paginate,
  requireContract,
  requireDictItem,
  totalDeliveredCents,
  totalPaidCents,
} from '../helpers.js'
import { defineCommand } from '../registry.js'
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  contractStatusLogSchema,
  contractViewSchema,
  deliveryViewSchema,
  directionSchema,
  paymentViewSchema,
} from './shapes.js'

/** 合同列表排序字段。 */
const SORT_FIELDS = ['no', 'counterparty', 'amountCents', 'dueDate', 'updatedAt'] as const

/** 合同列表排序字段类型。 */
type SortField = (typeof SORT_FIELDS)[number]

/** 合同视图比较器。 */
const SORTERS: Record<SortField, (a: ContractView, b: ContractView) => number> = {
  no: (a, b) => a.no.localeCompare(b.no, 'zh'),
  counterparty: (a, b) => a.counterparty.localeCompare(b.counterparty, 'zh'),
  amountCents: (a, b) => a.amountCents - b.amountCents,
  dueDate: (a, b) => a.dueDate.localeCompare(b.dueDate),
  updatedAt: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
}

/** contract.upsert 入参。 */
const contractUpsertInput = z
  .object({
    id: z.uuid().optional(),
    no: nonEmptyString(64),
    projectName: z.string().max(200).optional(),
    direction: directionSchema,
    counterparty: nonEmptyString(200),
    typeCode: nonEmptyString(64),
    statusCode: nonEmptyString(64),
    ownerId: z.uuid().nullable(),
    ownerName: z.string().max(100).optional(),
    amountCents: z.int().min(0, '合同金额不能为负数'),
    signDate: isoDate,
    startDate: isoDate,
    dueDate: isoDate,
    note: z.string().max(1000).optional(),
    statusChangedAt: isoDateTime.optional(),
  })
  .strict()

/** contract.get 入参：id 或 no 二选一。 */
const contractGetInput = z
  .object({
    id: z.uuid().optional(),
    no: nonEmptyString(64).optional(),
  })
  .strict()
  .refine((value) => value.id !== undefined || value.no !== undefined, {
    message: '必须提供 id 或 no。',
    path: ['id'],
  })

/** contract.list 入参。 */
const contractListInput = z
  .object({
    direction: directionSchema.optional(),
    statusCode: nonEmptyString(64).optional(),
    ownerId: z.uuid().optional(),
    search: z.string().max(200).optional(),
    page: z.int().default(1),
    pageSize: z.int().default(20),
    sortBy: z.enum(SORT_FIELDS).default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict()

/** contract.delete / contract.statusLogs 入参。 */
const contractIdInput = z.object({ id: z.uuid() }).strict()
const contractStatusLogsInput = z.object({ contractId: z.uuid() }).strict()

/** contract.upsert：新增或更新合同，同步状态日志。 */
export const contractUpsertCommand = defineCommand({
  name: 'contract.upsert',
  summary: '新增或更新合同（编号唯一、日期先后、负责人在职、方向与金额锁定校验）',
  input: contractUpsertInput,
  output: z.object({ contract: contractViewSchema }).strict(),
  annotations: WRITE_ANNOTATIONS,
  errorCodes: [
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'DUPLICATE_NO',
    'OWNER_INACTIVE',
    'CONTRACT_DIRECTION_LOCKED',
    'AMOUNT_BELOW_PAID',
    'AMOUNT_BELOW_DELIVERED',
  ],
  handler: async (input, ctx) => {
    const existing = input.id === undefined ? null : requireContract(ctx.store, input.id)
    const now = nowIso()

    invariantOrThrow(assertDateOrder(input.startDate, input.dueDate))
    invariantOrThrow(
      assertContractNoUnique(
        ctx.store.contracts.list().map((row) => ({ id: row.id, no: row.no })),
        input.no,
        existing?.id,
      ),
    )

    if (existing !== null) {
      const hasExecution =
        ctx.store.payments.listByContract(existing.id).length > 0 ||
        ctx.store.deliveries.listByContract(existing.id).length > 0
      invariantOrThrow(
        assertDirectionChangeAllowed(hasExecution, existing.direction, input.direction),
      )
      invariantOrThrow(
        assertAmountAtLeastCommitted(
          input.amountCents,
          totalPaidCents(ctx.store, existing),
          totalDeliveredCents(ctx.store, existing),
        ),
      )
    }

    assertOwnerActive(ctx.store, input.ownerId)
    const owner = input.ownerId === null ? null : ctx.store.personnel.getById(input.ownerId)
    const type = requireDictItem(ctx.store, 'contractType', input.typeCode)
    const status = requireDictItem(ctx.store, 'contractStatus', input.statusCode)

    const statusChanged = existing === null || existing.statusCode !== input.statusCode
    const statusChangedAt =
      existing === null
        ? (input.statusChangedAt ?? now)
        : statusChanged
          ? now
          : (input.statusChangedAt ?? existing.statusChangedAt)

    const row: ContractRow = {
      id: existing?.id ?? newId(),
      no: input.no,
      projectName: input.projectName ?? existing?.projectName ?? '',
      direction: input.direction,
      counterparty: input.counterparty,
      typeItemId: type.id,
      typeCode: type.code,
      typeName: type.name,
      statusItemId: status.id,
      statusCode: status.code,
      statusName: status.name,
      amountCents: input.amountCents,
      openingPaidCents: existing?.openingPaidCents ?? 0,
      paidCents: existing?.paidCents ?? 0,
      unpaidCents: existing?.unpaidCents ?? 0,
      receivedAmountCents: existing?.receivedAmountCents ?? 0,
      openingDeliveredCents: existing?.openingDeliveredCents ?? 0,
      deliveredCents: existing?.deliveredCents ?? 0,
      lastDeliveryDate: existing?.lastDeliveryDate ?? null,
      fundingPercent: existing?.fundingPercent ?? null,
      deliveryPercent: existing?.deliveryPercent ?? null,
      executionGapCents: existing?.executionGapCents ?? 0,
      gapState: existing?.gapState ?? 'none',
      ownerId: input.ownerId,
      ownerName: input.ownerName ?? owner?.name ?? existing?.ownerName ?? '',
      note: input.note ?? existing?.note ?? '',
      signDate: input.signDate,
      startDate: input.startDate,
      dueDate: input.dueDate,
      statusChangedAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    if (existing === null) {
      ctx.store.contracts.insert(row)
    } else {
      ctx.store.contracts.update(row)
    }

    if (statusChanged) {
      ctx.store.statusLogs.insert({
        id: newId(),
        contractId: row.id,
        fromCode: existing?.statusCode ?? '',
        toCode: status.code,
        changedAt: statusChangedAt ?? now,
        actor: ctx.actor,
        note: '状态变更',
      })
    }

    const stored = ctx.store.contracts.getById(row.id) ?? row
    return { data: { contract: computeView(ctx.store, stored) } }
  },
})

/** contract.get：读取合同详情与关联执行记录。 */
export const contractGetCommand = defineCommand({
  name: 'contract.get',
  summary: '按 id 或合同编号读取合同详情（含资金流水、交付明细与状态日志）',
  input: contractGetInput,
  output: z
    .object({
      contract: contractViewSchema,
      payments: z.array(paymentViewSchema),
      deliveries: z.array(deliveryViewSchema),
      statusLogs: z.array(contractStatusLogSchema),
    })
    .strict(),
  annotations: READ_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED', 'NOT_FOUND'],
  handler: async (input, ctx) => {
    const contract =
      input.id !== undefined
        ? ctx.store.contracts.getById(input.id)
        : ctx.store.contracts.getByNo(input.no ?? '')
    if (contract === null) {
      throw new LedgerError('NOT_FOUND', `合同不存在：${input.id ?? input.no ?? ''}`, {
        id: input.id,
        no: input.no,
      })
    }
    return {
      data: {
        contract: computeView(ctx.store, contract),
        payments: ctx.store.payments.listByContract(contract.id),
        deliveries: ctx.store.deliveries.listByContract(contract.id),
        statusLogs: ctx.store.statusLogs.listByContract(contract.id),
      },
    }
  },
})

/** contract.list：分页、筛选、排序。 */
export const contractListCommand = defineCommand({
  name: 'contract.list',
  summary: '分页查询合同列表（支持方向、状态、负责人筛选与多字段排序）',
  input: contractListInput,
  output: z
    .object({
      items: z.array(contractViewSchema),
      total: z.int(),
      page: z.int(),
      pageSize: z.int(),
    })
    .strict(),
  annotations: READ_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED'],
  handler: async (input, ctx) => {
    const query: ContractListQuery = {}
    if (input.direction !== undefined) query.direction = input.direction
    if (input.statusCode !== undefined) query.statusCode = input.statusCode
    if (input.ownerId !== undefined) query.ownerId = input.ownerId
    if (input.search !== undefined) query.search = input.search
    const rows = ctx.store.contracts.list(query)
    const views = rows.map((row) => computeView(ctx.store, row))
    const direction = input.sortOrder === 'asc' ? 1 : -1
    const sorter = SORTERS[input.sortBy]
    views.sort((a, b) => sorter(a, b) * direction)
    const slice = paginate(views, input.page, input.pageSize)
    return {
      data: {
        items: slice.items,
        total: slice.total,
        page: slice.page,
        pageSize: slice.pageSize,
      },
    }
  },
})

/** contract.delete：删除合同，关联流水/交付/状态日志由存储层级联。 */
export const contractDeleteCommand = defineCommand({
  name: 'contract.delete',
  summary: '删除合同（同事务级联删除其资金流水、交付明细与状态日志）',
  input: contractIdInput,
  output: z.object({ id: z.uuid() }).strict(),
  annotations: DESTRUCTIVE_ANNOTATIONS,
  errorCodes: ['NOT_FOUND'],
  handler: async (input, ctx) => {
    requireContract(ctx.store, input.id)
    ctx.store.contracts.delete(input.id)
    return { data: { id: input.id } }
  },
})

/** contract.statusLogs：读取合同状态变更历史（只追加）。 */
export const contractStatusLogsCommand = defineCommand({
  name: 'contract.statusLogs',
  summary: '读取指定合同的状态变更日志',
  input: contractStatusLogsInput,
  output: z.object({ items: z.array(contractStatusLogSchema) }).strict(),
  annotations: READ_ANNOTATIONS,
  errorCodes: ['NOT_FOUND'],
  handler: async (input, ctx) => {
    requireContract(ctx.store, input.contractId)
    return { data: { items: ctx.store.statusLogs.listByContract(input.contractId) } }
  },
})
