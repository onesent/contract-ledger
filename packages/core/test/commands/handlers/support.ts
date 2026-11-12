/**
 * 领域命令测试夹具：真实注册表 + 内存存储 + 字典/人员种子。
 */
import { randomUUID } from 'node:crypto'
import {
  CommandRegistry,
  dispatch,
  MemoryLedgerStore,
  registerCoreCommands,
  type CommandResult,
  type ContractView,
  type PersonnelRow,
} from '@ledger/core'

/** 模块级共享注册表：命令定义不可变，可安全复用。 */
const REGISTRY = new CommandRegistry()
registerCoreCommands(REGISTRY)

/** 种子字典 id 集合。 */
export interface SeedIds {
  contractTypeCategoryId: string
  contractStatusCategoryId: string
  payMethodCategoryId: string
  departmentCategoryId: string
  salesTypeId: string
  purchaseTypeId: string
  draftStatusId: string
  executingStatusId: string
  finishedStatusId: string
  terminatedStatusId: string
  transferMethodId: string
  devDepartmentId: string
  salesDepartmentId: string
}

/**
 * 写入合同/状态/付款方式/部门四类字典分类与常用字典项。
 * @param store 内存存储
 * @returns 种子 id 集合
 */
export function seedDicts(store: MemoryLedgerStore): SeedIds {
  const now = '2026-01-01T00:00:00.000Z'
  const category = (code: string, name: string, sort: number): string => {
    const id = randomUUID()
    store.dicts.insertCategory({ id, code, name, builtin: true, sort, createdAt: now, updatedAt: now })
    return id
  }
  const item = (categoryCode: string, code: string, name: string, sort: number): string => {
    const id = randomUUID()
    store.dicts.insertItem({
      id,
      categoryCode,
      code,
      name,
      color: '#409EFF',
      sort,
      enabled: true,
      builtin: true,
      note: '',
      createdAt: now,
      updatedAt: now,
    })
    return id
  }

  const contractTypeCategoryId = category('contractType', '合同类型', 1)
  const contractStatusCategoryId = category('contractStatus', '合同状态', 2)
  const payMethodCategoryId = category('payMethod', '付款方式', 3)
  const departmentCategoryId = category('department', '部门', 4)

  const salesTypeId = item('contractType', 'sales', '销售合同', 1)
  const purchaseTypeId = item('contractType', 'purchase', '采购合同', 2)
  const draftStatusId = item('contractStatus', 'draft', '草稿', 1)
  const executingStatusId = item('contractStatus', 'executing', '执行中', 2)
  const finishedStatusId = item('contractStatus', 'finished', '已完结', 3)
  const terminatedStatusId = item('contractStatus', 'terminated', '已终止', 4)
  const transferMethodId = item('payMethod', 'transfer', '银行转账', 1)
  const devDepartmentId = item('department', 'dev', '研发部', 1)
  const salesDepartmentId = item('department', 'sales', '销售部', 2)

  return {
    contractTypeCategoryId,
    contractStatusCategoryId,
    payMethodCategoryId,
    departmentCategoryId,
    salesTypeId,
    purchaseTypeId,
    draftStatusId,
    executingStatusId,
    finishedStatusId,
    terminatedStatusId,
    transferMethodId,
    devDepartmentId,
    salesDepartmentId,
  }
}

/**
 * 写入一名人员档案。
 * @param store 内存存储
 * @param overrides 覆盖字段
 * @returns 人员行
 */
export function seedPersonnel(
  store: MemoryLedgerStore,
  overrides: Partial<PersonnelRow> = {},
): PersonnelRow {
  const now = '2026-01-01T00:00:00.000Z'
  const row: PersonnelRow = {
    id: randomUUID(),
    code: 'P001',
    name: '张伟',
    deptCode: 'dev',
    deptName: '研发部',
    position: '经理',
    phone: '',
    email: '',
    active: true,
    hireDate: '2020-01-01',
    note: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
  store.personnel.insert(row)
  return row
}

/** 合同 upsert 入参测试形状。 */
export interface ContractUpsertShape {
  id?: string
  no: string
  projectName?: string
  direction: 'sale' | 'purchase'
  counterparty: string
  typeCode: string
  statusCode: string
  ownerId: string | null
  ownerName?: string
  amountCents: number
  signDate: string
  startDate: string
  dueDate: string
  note?: string
  statusChangedAt?: string
}

/**
 * 构造合法的合同 upsert 入参。
 * @param overrides 覆盖字段
 * @returns 合同入参
 */
export function makeContractInput(overrides: Partial<ContractUpsertShape> = {}): ContractUpsertShape {
  return {
    no: 'HT-2026-001',
    projectName: '测试项目',
    direction: 'sale',
    counterparty: '甲方单位',
    typeCode: 'sales',
    statusCode: 'executing',
    ownerId: null,
    amountCents: 100000,
    signDate: '2026-01-01',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
    ...overrides,
  }
}

/**
 * 分派一条核心命令，写命令自动生成幂等键。
 * @param store 内存存储
 * @param name 命令名
 * @param input 入参
 * @param options 可选幂等键与 dry-run
 * @returns 命令结果
 */
export async function dispatchCore(
  store: MemoryLedgerStore,
  name: string,
  input: unknown,
  options: { idempotencyKey?: string; dryRun?: boolean; actor?: string } = {},
): Promise<CommandResult<unknown>> {
  return dispatch(REGISTRY, name, input, {
    store,
    actor: options.actor ?? 'agent:test',
    transport: 'cli',
    idempotencyKey: options.idempotencyKey ?? randomUUID(),
    dryRun: options.dryRun,
  })
}

/**
 * 创建合同并断言成功。
 * @param store 内存存储
 * @param overrides 覆盖字段
 * @returns 合同视图
 */
export async function createContract(
  store: MemoryLedgerStore,
  overrides: Partial<ContractUpsertShape> = {},
): Promise<ContractView> {
  const result = await dispatchCore(store, 'contract.upsert', makeContractInput(overrides))
  if (!result.ok) throw new Error(result.message)
  return (result.data as { contract: ContractView }).contract
}
