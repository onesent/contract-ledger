/**
 * 人员档案命令：新增/更新、列表（含部门名称）、删除（引用保护）与批量转交。
 */
import { z } from 'zod'
import type { PersonnelRow } from '../../contracts/api-shapes.js'
import { LedgerError } from '../../contracts/ledger-error.js'
import { assertOwnerActive as assertOwnerActiveResult } from '../../invariants.js'
import { isoDate, nonEmptyString } from '../../schema/primitives.js'
import { invariantOrThrow, newId, nowIso } from '../helpers.js'
import { defineCommand, type CommandContext } from '../registry.js'
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  personnelViewSchema,
} from './shapes.js'

/** personnel.upsert 入参。 */
const personnelUpsertInput = z
  .object({
    id: z.uuid().optional(),
    code: nonEmptyString(32),
    name: nonEmptyString(50),
    deptCode: z.string().max(64).optional(),
    position: z.string().max(100).optional(),
    phone: z.string().max(32).optional(),
    email: z.string().max(200).optional(),
    active: z.boolean().optional(),
    hireDate: isoDate.optional(),
    note: z.string().max(500).optional(),
  })
  .strict()

/** personnel.list 入参。 */
const personnelListInput = z
  .object({
    includeInactive: z.boolean().default(false),
    search: z.string().max(200).optional(),
  })
  .strict()

/** personnel.delete 入参。 */
const personnelDeleteInput = z.object({ id: z.uuid() }).strict()

/** personnel.transfer 入参。 */
const personnelTransferInput = z.object({ fromId: z.uuid(), toId: z.uuid() }).strict()

/**
 * 解析部门名称：优先取 department 字典项名称，未匹配时回落为编码。
 * @param ctx 命令上下文
 * @param deptCode 部门编码
 * @returns 部门名称
 */
function resolveDeptName(ctx: CommandContext, deptCode: string): string {
  if (deptCode === '') return ''
  return ctx.store.dicts.findItem('department', deptCode)?.name ?? deptCode
}

/** personnel.upsert：新增或更新人员档案。 */
export const personnelUpsertCommand = defineCommand({
  name: 'personnel.upsert',
  summary: '新增或更新人员档案（人员编号忽略大小写唯一）',
  input: personnelUpsertInput,
  output: z.object({ personnel: personnelViewSchema }).strict(),
  annotations: WRITE_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED', 'NOT_FOUND'],
  handler: async (input, ctx) => {
    const existing = input.id === undefined ? null : ctx.store.personnel.getById(input.id)
    if (input.id !== undefined && existing === null) {
      throw new LedgerError('NOT_FOUND', `人员不存在：${input.id}`, { id: input.id })
    }
    const targetCode = input.code.trim().toLowerCase()
    const duplicate = ctx.store.personnel
      .list(true)
      .find((row) => row.id !== existing?.id && row.code.trim().toLowerCase() === targetCode)
    if (duplicate !== undefined) {
      throw new LedgerError('VALIDATION_FAILED', `人员编号已存在：${input.code}`, {
        field: 'code',
        code: input.code,
      })
    }

    const now = nowIso()
    const deptCode = input.deptCode ?? existing?.deptCode ?? ''
    const row: PersonnelRow = {
      id: existing?.id ?? newId(),
      code: input.code,
      name: input.name,
      deptCode,
      deptName: resolveDeptName(ctx, deptCode),
      position: input.position ?? existing?.position ?? '',
      phone: input.phone ?? existing?.phone ?? '',
      email: input.email ?? existing?.email ?? '',
      active: input.active ?? existing?.active ?? true,
      hireDate: input.hireDate ?? existing?.hireDate ?? null,
      note: input.note ?? existing?.note ?? '',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    if (existing === null) {
      ctx.store.personnel.insert(row)
    } else {
      ctx.store.personnel.update(row)
    }
    return { data: { personnel: row } }
  },
})

/** personnel.list：按在职状态与关键字查询人员。 */
export const personnelListCommand = defineCommand({
  name: 'personnel.list',
  summary: '查询人员档案（可含离职人员，按姓名/编号/联系方式搜索）',
  input: personnelListInput,
  output: z.object({ items: z.array(personnelViewSchema) }).strict(),
  annotations: READ_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED'],
  handler: async (input, ctx) => {
    const term = (input.search ?? '').trim().toLowerCase()
    const rows = ctx.store.personnel.list(input.includeInactive)
    const items = rows
      .map((row) => ({ ...row, deptName: resolveDeptName(ctx, row.deptCode) }))
      .filter((row) => {
        if (term === '') return true
        const haystack = `${row.code}\n${row.name}\n${row.phone}\n${row.email}\n${row.deptName}`
        return haystack.toLowerCase().includes(term)
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    return { data: { items } }
  },
})

/** personnel.delete：删除人员，仍负责合同时拒绝。 */
export const personnelDeleteCommand = defineCommand({
  name: 'personnel.delete',
  summary: '删除人员档案（仍被合同引用时拒绝删除）',
  input: personnelDeleteInput,
  output: z.object({ id: z.uuid() }).strict(),
  annotations: DESTRUCTIVE_ANNOTATIONS,
  errorCodes: ['NOT_FOUND', 'REFERENCE_IN_USE'],
  handler: async (input, ctx) => {
    const existing = ctx.store.personnel.getById(input.id)
    if (existing === null) {
      throw new LedgerError('NOT_FOUND', `人员不存在：${input.id}`, { id: input.id })
    }
    const references = ctx.store.contracts.list({ ownerId: input.id }).length
    if (references > 0) {
      throw new LedgerError('REFERENCE_IN_USE', '该人员仍负责合同，需先转交后再删除。', {
        entity: 'personnel',
        id: input.id,
        references,
      })
    }
    ctx.store.personnel.delete(input.id)
    return { data: { id: input.id } }
  },
})

/** personnel.transfer：把某人的全部合同转交给另一位在职人员。 */
export const personnelTransferCommand = defineCommand({
  name: 'personnel.transfer',
  summary: '把离职/在岗人员名下的全部合同批量转交给另一位在职人员',
  input: personnelTransferInput,
  output: z.object({ moved: z.int() }).strict(),
  annotations: DESTRUCTIVE_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED', 'NOT_FOUND', 'OWNER_INACTIVE'],
  handler: async (input, ctx) => {
    if (input.fromId === input.toId) {
      throw new LedgerError('VALIDATION_FAILED', '转交对象不能是同一人。', {
        field: 'toId',
        fromId: input.fromId,
        toId: input.toId,
      })
    }
    const from = ctx.store.personnel.getById(input.fromId)
    if (from === null) {
      throw new LedgerError('NOT_FOUND', `人员不存在：${input.fromId}`, { id: input.fromId })
    }
    const to = ctx.store.personnel.getById(input.toId)
    if (to === null) {
      throw new LedgerError('NOT_FOUND', `人员不存在：${input.toId}`, { id: input.toId })
    }
    invariantOrThrow(assertOwnerActiveResult(to.active))

    const now = nowIso()
    const targets = ctx.store.contracts.list({ ownerId: from.id })
    for (const contract of targets) {
      ctx.store.contracts.update({
        ...contract,
        ownerId: to.id,
        ownerName: to.name,
        updatedAt: now,
      })
    }
    return { data: { moved: targets.length } }
  },
})
