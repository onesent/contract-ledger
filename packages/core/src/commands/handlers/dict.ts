/**
 * 字典命令：分类/字典项新增或更新、列表、删除（引用保护）。
 */
import { z } from 'zod'
import type { DictCategoryRow, DictItemRow } from '../../contracts/api-shapes.js'
import { LedgerError } from '../../contracts/ledger-error.js'
import { hexColor, nonEmptyString } from '../../schema/primitives.js'
import { newId, nowIso } from '../helpers.js'
import { defineCommand } from '../registry.js'
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  dictCategoryViewSchema,
  dictItemViewSchema,
} from './shapes.js'

/** 分类 upsert 入参。 */
const dictCategoryUpsertInput = z
  .object({
    kind: z.literal('category'),
    id: z.uuid().optional(),
    categoryCode: nonEmptyString(64),
    name: nonEmptyString(50),
    sort: z.int().optional(),
  })
  .strict()

/** 字典项 upsert 入参。 */
const dictItemUpsertInput = z
  .object({
    kind: z.literal('item'),
    id: z.uuid().optional(),
    categoryCode: nonEmptyString(64),
    code: nonEmptyString(64),
    name: nonEmptyString(50),
    color: hexColor.optional(),
    enabled: z.boolean().optional(),
    sort: z.int().optional(),
  })
  .strict()

/** dict.upsert 入参：按 kind 判别。 */
const dictUpsertInput = z.discriminatedUnion('kind', [
  dictCategoryUpsertInput,
  dictItemUpsertInput,
])

/** dict.list 入参。 */
const dictListInput = z.object({ categoryCode: z.string().max(64).optional() }).strict()

/** dict.delete 入参。 */
const dictDeleteInput = z
  .object({ kind: z.enum(['category', 'item']), id: z.uuid() })
  .strict()

/** dict.upsert：新增或更新字典分类/字典项。 */
export const dictUpsertCommand = defineCommand({
  name: 'dict.upsert',
  summary: '新增或更新字典分类或字典项（同分类下编码唯一）',
  input: dictUpsertInput,
  output: z
    .object({
      category: dictCategoryViewSchema.optional(),
      item: dictItemViewSchema.optional(),
    })
    .strict(),
  annotations: WRITE_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED', 'NOT_FOUND'],
  handler: async (input, ctx) => {
    const now = nowIso()
    if (input.kind === 'category') {
      const categories = ctx.store.dicts.listCategories()
      const existing =
        input.id === undefined ? null : categories.find((row) => row.id === input.id) ?? null
      if (input.id !== undefined && existing === null) {
        throw new LedgerError('NOT_FOUND', `字典分类不存在：${input.id}`, { id: input.id })
      }
      const targetCode = input.categoryCode.trim().toLowerCase()
      const duplicate = categories.find(
        (row) => row.id !== existing?.id && row.code.trim().toLowerCase() === targetCode,
      )
      if (duplicate !== undefined) {
        throw new LedgerError('VALIDATION_FAILED', `字典分类编码已存在：${input.categoryCode}`, {
          field: 'categoryCode',
          categoryCode: input.categoryCode,
        })
      }
      const row: DictCategoryRow = {
        id: existing?.id ?? newId(),
        code: input.categoryCode,
        name: input.name,
        builtin: existing?.builtin ?? false,
        sort: input.sort ?? existing?.sort ?? 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      if (existing === null) {
        ctx.store.dicts.insertCategory(row)
      } else {
        ctx.store.dicts.updateCategory(row)
      }
      return { data: { category: row } }
    }

    const categoryExists = ctx.store.dicts
      .listCategories()
      .some((row) => row.code === input.categoryCode)
    if (!categoryExists) {
      throw new LedgerError('VALIDATION_FAILED', `字典分类不存在：${input.categoryCode}`, {
        field: 'categoryCode',
        categoryCode: input.categoryCode,
        hint: '先用 dict.upsert（kind=category）创建分类。',
      })
    }
    const existing =
      input.id === undefined ? null : ctx.store.dicts.getItemById(input.id)
    if (input.id !== undefined && existing === null) {
      throw new LedgerError('NOT_FOUND', `字典项不存在：${input.id}`, { id: input.id })
    }
    const targetCode = input.code.trim().toLowerCase()
    const duplicate = ctx.store.dicts
      .listItems()
      .find(
        (row) =>
          row.id !== existing?.id &&
          row.categoryCode === input.categoryCode &&
          row.code.trim().toLowerCase() === targetCode,
      )
    if (duplicate !== undefined) {
      throw new LedgerError('VALIDATION_FAILED', `字典项编码已存在：${input.code}`, {
        field: 'code',
        code: input.code,
      })
    }
    const row: DictItemRow = {
      id: existing?.id ?? newId(),
      categoryCode: input.categoryCode,
      code: input.code,
      name: input.name,
      color: input.color ?? existing?.color ?? '#409EFF',
      sort: input.sort ?? existing?.sort ?? 0,
      enabled: input.enabled ?? existing?.enabled ?? true,
      builtin: existing?.builtin ?? false,
      note: existing?.note ?? '',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    if (existing === null) {
      ctx.store.dicts.insertItem(row)
    } else {
      ctx.store.dicts.updateItem(row)
    }
    return { data: { item: row } }
  },
})

/** dict.list：列出分类与字典项。 */
export const dictListCommand = defineCommand({
  name: 'dict.list',
  summary: '列出字典分类与字典项（可按分类编码过滤字典项）',
  input: dictListInput,
  output: z
    .object({
      categories: z.array(dictCategoryViewSchema),
      items: z.array(dictItemViewSchema),
    })
    .strict(),
  annotations: READ_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED'],
  handler: async (input, ctx) => ({
    data: {
      categories: ctx.store.dicts.listCategories(),
      items: ctx.store.dicts.listItems(input.categoryCode),
    },
  }),
})

/** dict.delete：删除字典分类或字典项，仍有引用时拒绝。 */
export const dictDeleteCommand = defineCommand({
  name: 'dict.delete',
  summary: '删除字典分类或字典项（仍有字典项或合同引用时拒绝）',
  input: dictDeleteInput,
  output: z.object({ id: z.uuid() }).strict(),
  annotations: DESTRUCTIVE_ANNOTATIONS,
  errorCodes: ['NOT_FOUND', 'REFERENCE_IN_USE'],
  handler: async (input, ctx) => {
    if (input.kind === 'category') {
      const category = ctx.store.dicts.listCategories().find((row) => row.id === input.id)
      if (category === undefined) {
        throw new LedgerError('NOT_FOUND', `字典分类不存在：${input.id}`, { id: input.id })
      }
      const references = ctx.store.dicts.listItems(category.code).length
      if (references > 0) {
        throw new LedgerError('REFERENCE_IN_USE', '该字典分类仍有字典项，需先删除字典项。', {
          entity: 'dictCategory',
          id: input.id,
          references,
        })
      }
      ctx.store.dicts.deleteCategory(input.id)
      return { data: { id: input.id } }
    }

    const item = ctx.store.dicts.getItemById(input.id)
    if (item === null) {
      throw new LedgerError('NOT_FOUND', `字典项不存在：${input.id}`, { id: input.id })
    }
    const references = ctx.store.contracts
      .list()
      .filter((row) => row.typeItemId === input.id || row.statusItemId === input.id).length
    if (references > 0) {
      throw new LedgerError('REFERENCE_IN_USE', '该字典项仍被合同引用，需先改绑后再删除。', {
        entity: 'dictItem',
        id: input.id,
        references,
      })
    }
    ctx.store.dicts.deleteItem(input.id)
    return { data: { id: input.id } }
  },
})
