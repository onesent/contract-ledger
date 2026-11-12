import { describe, expect, it } from 'vitest'
import {
  MemoryLedgerStore,
  type DictCategoryRow,
  type DictItemRow,
} from '@ledger/core'
import { createContract, dispatchCore, seedDicts, type SeedIds } from './support.js'

/** dict.upsert 输出形状。 */
interface DictUpsertData {
  category?: DictCategoryRow
  item?: DictItemRow
}

/** dict.list 输出形状。 */
interface DictListData {
  categories: DictCategoryRow[]
  items: DictItemRow[]
}

/**
 * 构造带内置字典的内存库。
 * @returns 存储与字典 id
 */
function setup(): { store: MemoryLedgerStore; ids: SeedIds } {
  const store = new MemoryLedgerStore()
  return { store, ids: seedDicts(store) }
}

describe('dict.upsert / list', () => {
  it('新增分类与字典项后可按分类列出', async () => {
    const { store } = setup()
    const categoryResult = await dispatchCore(store, 'dict.upsert', {
      kind: 'category',
      categoryCode: 'region',
      name: '地区',
      sort: 5,
    })
    expect(categoryResult.ok).toBe(true)
    if (!categoryResult.ok) return
    const category = (categoryResult.data as DictUpsertData).category
    expect(category?.code).toBe('region')

    const itemResult = await dispatchCore(store, 'dict.upsert', {
      kind: 'item',
      categoryCode: 'region',
      code: 'north',
      name: '北方',
      color: '#FF0000',
    })
    expect(itemResult.ok).toBe(true)
    if (!itemResult.ok) return
    const item = (itemResult.data as DictUpsertData).item
    expect(item?.code).toBe('north')
    expect(item?.color).toBe('#FF0000')

    const list = await dispatchCore(store, 'dict.list', { categoryCode: 'region' })
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const data = list.data as DictListData
    expect(data.categories.map((row) => row.code)).toContain('region')
    expect(data.items).toHaveLength(1)
    expect(data.items[0]?.code).toBe('north')
  })

  it('同分类下字典项编码重复时返回 VALIDATION_FAILED', async () => {
    const { store } = setup()
    await dispatchCore(store, 'dict.upsert', {
      kind: 'item',
      categoryCode: 'contractType',
      code: 'custom',
      name: '自定义类型',
    })
    const duplicate = await dispatchCore(store, 'dict.upsert', {
      kind: 'item',
      categoryCode: 'contractType',
      code: 'CUSTOM',
      name: '重复类型',
    })
    expect(duplicate.ok).toBe(false)
    if (duplicate.ok) return
    expect(duplicate.code).toBe('VALIDATION_FAILED')
  })

  it('字典项引用的分类不存在时返回 VALIDATION_FAILED', async () => {
    const { store } = setup()
    const result = await dispatchCore(store, 'dict.upsert', {
      kind: 'item',
      categoryCode: 'missing',
      code: 'x',
      name: '孤儿项',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION_FAILED')
    expect(result.details).toMatchObject({ field: 'categoryCode' })
  })
})

describe('dict.delete', () => {
  it('分类下仍有字典项时返回 REFERENCE_IN_USE', async () => {
    const { store, ids } = setup()
    const result = await dispatchCore(store, 'dict.delete', {
      kind: 'category',
      id: ids.contractTypeCategoryId,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('REFERENCE_IN_USE')
    expect(store.dicts.listCategories()).toHaveLength(4)
  })

  it('字典项被合同引用时返回 REFERENCE_IN_USE', async () => {
    const { store, ids } = setup()
    await createContract(store, { no: 'HT-DICT', typeCode: 'sales' })
    const result = await dispatchCore(store, 'dict.delete', {
      kind: 'item',
      id: ids.salesTypeId,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('REFERENCE_IN_USE')
    expect(store.dicts.getItemById(ids.salesTypeId)).not.toBeNull()
  })

  it('未被引用的字典项与空分类可以删除', async () => {
    const { store } = setup()
    const categoryResult = await dispatchCore(store, 'dict.upsert', {
      kind: 'category',
      categoryCode: 'region',
      name: '地区',
    })
    if (!categoryResult.ok) return
    const category = (categoryResult.data as DictUpsertData).category
    const itemResult = await dispatchCore(store, 'dict.upsert', {
      kind: 'item',
      categoryCode: 'region',
      code: 'south',
      name: '南方',
    })
    if (!itemResult.ok || category === undefined) return
    const item = (itemResult.data as DictUpsertData).item
    if (item === undefined) return

    const deleteItem = await dispatchCore(store, 'dict.delete', { kind: 'item', id: item.id })
    expect(deleteItem.ok).toBe(true)
    const deleteCategory = await dispatchCore(store, 'dict.delete', {
      kind: 'category',
      id: category.id,
    })
    expect(deleteCategory.ok).toBe(true)
    expect(store.dicts.listCategories().some((row) => row.code === 'region')).toBe(false)
  })
})
