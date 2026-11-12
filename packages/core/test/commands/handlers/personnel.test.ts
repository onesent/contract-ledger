import { describe, expect, it } from 'vitest'
import { MemoryLedgerStore, type ContractView, type PersonnelRow } from '@ledger/core'
import { createContract, dispatchCore, seedDicts } from './support.js'

/** 人员 upsert 输出形状。 */
interface PersonnelUpsertData {
  personnel: PersonnelRow
}

/**
 * 构造带字典的内存库。
 * @returns 存储
 */
function setup(): MemoryLedgerStore {
  const store = new MemoryLedgerStore()
  seedDicts(store)
  return store
}

/**
 * 通过命令新增人员。
 * @param store 内存存储
 * @param input 人员入参
 * @returns 人员行
 */
async function upsertPersonnel(
  store: MemoryLedgerStore,
  input: Record<string, unknown>,
): Promise<PersonnelRow> {
  const result = await dispatchCore(store, 'personnel.upsert', input)
  if (!result.ok) throw new Error(result.message)
  return (result.data as PersonnelUpsertData).personnel
}

describe('personnel.upsert / list', () => {
  it('新增人员并按在职状态与关键字过滤，部门名称由字典解析', async () => {
    const store = setup()
    const active = await upsertPersonnel(store, {
      code: 'P-100',
      name: '张三',
      deptCode: 'dev',
      position: '工程师',
    })
    expect(active.deptName).toBe('研发部')
    await upsertPersonnel(store, {
      code: 'P-200',
      name: '李四',
      deptCode: 'sales',
      active: false,
    })

    const defaults = await dispatchCore(store, 'personnel.list', {})
    expect(defaults.ok).toBe(true)
    if (!defaults.ok) return
    const activeItems = (defaults.data as { items: PersonnelRow[] }).items
    expect(activeItems).toHaveLength(1)
    expect(activeItems[0]?.code).toBe('P-100')

    const all = await dispatchCore(store, 'personnel.list', { includeInactive: true })
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect((all.data as { items: PersonnelRow[] }).items).toHaveLength(2)

    const searched = await dispatchCore(store, 'personnel.list', {
      includeInactive: true,
      search: '李',
    })
    if (!searched.ok) return
    const searchedItems = (searched.data as { items: PersonnelRow[] }).items
    expect(searchedItems).toHaveLength(1)
    expect(searchedItems[0]?.name).toBe('李四')
    expect(searchedItems[0]?.deptName).toBe('销售部')
  })

  it('人员编号忽略大小写重复时返回 VALIDATION_FAILED 且 details.field=code', async () => {
    const store = setup()
    await upsertPersonnel(store, { code: 'P-DUP', name: '王五' })
    const result = await dispatchCore(store, 'personnel.upsert', {
      code: 'p-dup',
      name: '王五二号',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION_FAILED')
    expect(result.details).toMatchObject({ field: 'code' })
  })
})

describe('personnel.delete', () => {
  it('仍负责合同时返回 REFERENCE_IN_USE', async () => {
    const store = setup()
    const owner = await upsertPersonnel(store, { code: 'P-OWNER', name: '赵六', deptCode: 'dev' })
    await createContract(store, { no: 'HT-OWNER', ownerId: owner.id })
    const result = await dispatchCore(store, 'personnel.delete', { id: owner.id })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('REFERENCE_IN_USE')
    expect(store.state().personnel).toHaveLength(1)
  })

  it('未被引用的人员可以删除', async () => {
    const store = setup()
    const person = await upsertPersonnel(store, { code: 'P-FREE', name: '孙七' })
    const result = await dispatchCore(store, 'personnel.delete', { id: person.id })
    expect(result.ok).toBe(true)
    expect(store.state().personnel).toHaveLength(0)
  })
})

describe('personnel.transfer', () => {
  it('把原负责人名下全部合同转交给在职人员并更新姓名快照', async () => {
    const store = setup()
    const from = await upsertPersonnel(store, { code: 'P-FROM', name: '旧负责人', deptCode: 'dev' })
    const to = await upsertPersonnel(store, { code: 'P-TO', name: '新负责人', deptCode: 'sales' })
    const first = await createContract(store, { no: 'HT-T1', ownerId: from.id })
    const second = await createContract(store, { no: 'HT-T2', ownerId: from.id })

    const result = await dispatchCore(store, 'personnel.transfer', {
      fromId: from.id,
      toId: to.id,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data as { moved: number }).moved).toBe(2)

    const movedFirst = store.contracts.getById(first.id)
    const movedSecond = store.contracts.getById(second.id)
    expect(movedFirst?.ownerId).toBe(to.id)
    expect(movedFirst?.ownerName).toBe('新负责人')
    expect(movedSecond?.ownerId).toBe(to.id)
    expect(movedSecond?.ownerName).toBe('新负责人')
    expect(store.contracts.list({ ownerId: from.id })).toHaveLength(0)
    expect(store.contracts.list({ ownerId: to.id })).toHaveLength(2)
  })

  it('转交对象已离职时返回 OWNER_INACTIVE', async () => {
    const store = setup()
    const from = await upsertPersonnel(store, { code: 'P-A', name: '甲', deptCode: 'dev' })
    const to = await upsertPersonnel(store, {
      code: 'P-B',
      name: '乙',
      deptCode: 'dev',
      active: false,
    })
    const result = await dispatchCore(store, 'personnel.transfer', {
      fromId: from.id,
      toId: to.id,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('OWNER_INACTIVE')
  })

  it('转交给同一人时返回 VALIDATION_FAILED', async () => {
    const store = setup()
    const person = await upsertPersonnel(store, { code: 'P-SELF', name: '自己' })
    const result = await dispatchCore(store, 'personnel.transfer', {
      fromId: person.id,
      toId: person.id,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION_FAILED')
  })
})
