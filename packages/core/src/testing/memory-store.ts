/**
 * 内存存储测试替身：与 SQLite 实现共享同一 LedgerStore 端口语义。
 * 负责事务快照回滚、幂等重放、dry-run 不落库、乐观并发与最小仓储守卫。
 */
import { randomUUID } from 'node:crypto'
import type {
  ContractRow,
  DeliveryRow,
  DictCategoryRow,
  DictItemRow,
  PaymentRow,
  PersonnelRow,
} from '../contracts/api-shapes.js'
import type { Transport } from '../contracts/envelope.js'
import { LedgerError } from '../contracts/ledger-error.js'
import type {
  ContractListQuery,
  ContractRepository,
  ContractStatusLogRepository,
  ContractStatusLogRow,
  DeliveryRepository,
  DictRepository,
  LedgerStore,
  PaymentRepository,
  PersonnelRepository,
  WriteMutation,
  WriteOptions,
  WriteResult,
} from '../contracts/store-port.js'
import { checkExpectedVersion } from '../contracts/versioning.js'

/** 内存审计行：只追加，字段与 SQLite audit_log 语义一致。 */
export interface MemoryAuditRow {
  id: string
  at: string
  actor: string
  transport: Transport
  command: string
  idempotencyKey: string | null
  versionBefore: number
  versionAfter: number
  summary: string
}

/** 内存幂等行：key 作用域为 (actor, command, key)。 */
export interface MemoryIdempotencyRow {
  actor: string
  command: string
  key: string
  fingerprint: string
  /** 首次执行时 handler 返回的业务数据。 */
  result: unknown
  version: number
}

/** 内存库只读快照，供测试断言。 */
export interface MemoryStoreState {
  readonly contracts: readonly ContractRow[]
  readonly payments: readonly PaymentRow[]
  readonly deliveries: readonly DeliveryRow[]
  readonly personnel: readonly PersonnelRow[]
  readonly dictCategories: readonly DictCategoryRow[]
  readonly dictItems: readonly DictItemRow[]
  readonly statusLogs: readonly ContractStatusLogRow[]
  readonly audits: readonly MemoryAuditRow[]
  readonly idempotency: readonly MemoryIdempotencyRow[]
  readonly version: number
}

/** 内部可变状态；仅本模块可见。 */
interface MemoryState {
  contracts: ContractRow[]
  payments: PaymentRow[]
  deliveries: DeliveryRow[]
  personnel: PersonnelRow[]
  dictCategories: DictCategoryRow[]
  dictItems: DictItemRow[]
  statusLogs: ContractStatusLogRow[]
  audits: MemoryAuditRow[]
  idempotency: Record<string, MemoryIdempotencyRow>
  version: number
}

/**
 * 深拷贝普通数据；所有跨仓储边界的数据都先克隆，避免外部引用污染事务状态。
 * @param value 任意结构化克隆支持的值
 * @returns 深拷贝
 */
function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * 合同编号归一化：忽略首尾空白与大小写，与领域不变量一致。
 * @param no 合同编号
 * @returns 归一化结果
 */
function normalizeContractNo(no: string): string {
  return no.trim().toLowerCase()
}

/**
 * 计算某合同的流水合计（分）。
 * @param state 内存状态
 * @param contractId 合同 id
 * @returns 合计金额
 */
function paidCentsOf(state: MemoryState, contractId: string): number {
  return state.payments
    .filter((row) => row.contractId === contractId)
    .reduce((sum, row) => sum + row.amountCents, 0)
}

/**
 * 计算某合同的有效交付合计（分）：rejected 不计入。
 * @param state 内存状态
 * @param contractId 合同 id
 * @returns 合计金额
 */
function deliveredCentsOf(state: MemoryState, contractId: string): number {
  return state.deliveries
    .filter((row) => row.contractId === contractId && row.status !== 'rejected')
    .reduce((sum, row) => sum + row.amountCents, 0)
}

/** 合同仓储实现。 */
class MemoryContractRepository implements ContractRepository {
  constructor(private readonly getState: () => MemoryState) {}

  getById(id: string): ContractRow | null {
    const row = this.getState().contracts.find((item) => item.id === id)
    return row === undefined ? null : clone(row)
  }

  getByNo(no: string): ContractRow | null {
    const target = normalizeContractNo(no)
    const row = this.getState().contracts.find((item) => normalizeContractNo(item.no) === target)
    return row === undefined ? null : clone(row)
  }

  list(query: ContractListQuery = {}): ContractRow[] {
    const term = (query.search ?? '').trim().toLowerCase()
    const rows = this.getState().contracts.filter((row) => {
      if (query.direction !== undefined && row.direction !== query.direction) return false
      if (query.statusCode !== undefined && row.statusCode !== query.statusCode) return false
      if (query.ownerId !== undefined && row.ownerId !== query.ownerId) return false
      if (term !== '') {
        const haystack = `${row.no}\n${row.projectName}\n${row.counterparty}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
    const offset = Math.max(0, query.offset ?? 0)
    const limit = query.limit === undefined ? rows.length : Math.max(0, query.limit)
    return rows.slice(offset, offset + limit).map((row) => clone(row))
  }

  insert(row: ContractRow): void {
    const state = this.getState()
    if (state.contracts.some((item) => item.id === row.id)) {
      throw new LedgerError('VALIDATION_FAILED', `合同 id 已存在：${row.id}`, { id: row.id })
    }
    const duplicate = state.contracts.some(
      (item) => normalizeContractNo(item.no) === normalizeContractNo(row.no),
    )
    if (duplicate) {
      throw new LedgerError('DUPLICATE_NO', `合同编号已存在：${row.no}`, { no: row.no })
    }
    state.contracts.push(clone(row))
  }

  update(row: ContractRow): void {
    const state = this.getState()
    const index = state.contracts.findIndex((item) => item.id === row.id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `合同不存在：${row.id}`, { id: row.id })
    }
    const duplicate = state.contracts.some(
      (item) => item.id !== row.id && normalizeContractNo(item.no) === normalizeContractNo(row.no),
    )
    if (duplicate) {
      throw new LedgerError('DUPLICATE_NO', `合同编号已存在：${row.no}`, { no: row.no })
    }
    state.contracts[index] = clone(row)
  }

  delete(id: string): void {
    const state = this.getState()
    const index = state.contracts.findIndex((item) => item.id === id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `合同不存在：${id}`, { id })
    }
    state.contracts.splice(index, 1)
    // 级联删除：流水、交付明细与状态日志随合同一并移除。
    state.payments = state.payments.filter((row) => row.contractId !== id)
    state.deliveries = state.deliveries.filter((row) => row.contractId !== id)
    state.statusLogs = state.statusLogs.filter((row) => row.contractId !== id)
  }
}

/** 资金流水仓储实现。 */
class MemoryPaymentRepository implements PaymentRepository {
  constructor(private readonly getState: () => MemoryState) {}

  getById(id: string): PaymentRow | null {
    const row = this.getState().payments.find((item) => item.id === id)
    return row === undefined ? null : clone(row)
  }

  listByContract(contractId: string): PaymentRow[] {
    return this.getState()
      .payments.filter((row) => row.contractId === contractId)
      .map((row) => clone(row))
  }

  insert(row: PaymentRow): void {
    const state = this.getState()
    const contract = state.contracts.find((item) => item.id === row.contractId)
    if (contract === undefined) {
      throw new LedgerError('NOT_FOUND', `合同不存在：${row.contractId}`, { id: row.contractId })
    }
    if (!Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) {
      throw new LedgerError('VALIDATION_FAILED', '付款金额必须为正整数分。', {
        amountCents: row.amountCents,
      })
    }
    if (state.payments.some((item) => item.id === row.id)) {
      throw new LedgerError('VALIDATION_FAILED', `流水 id 已存在：${row.id}`, { id: row.id })
    }
    const paidCents = paidCentsOf(state, row.contractId)
    const remainingCents = contract.amountCents - paidCents
    if (row.amountCents > remainingCents) {
      throw new LedgerError('PAYMENT_EXCEEDS_CONTRACT_AMOUNT', '本次付款超过合同剩余可付金额。', {
        amountCents: contract.amountCents,
        paidCents,
        addCents: row.amountCents,
        remainingCents,
      })
    }
    state.payments.push(clone(row))
  }

  delete(id: string): void {
    const state = this.getState()
    const index = state.payments.findIndex((item) => item.id === id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `流水不存在：${id}`, { id })
    }
    state.payments.splice(index, 1)
  }
}

/** 交付明细仓储实现。 */
class MemoryDeliveryRepository implements DeliveryRepository {
  constructor(private readonly getState: () => MemoryState) {}

  getById(id: string): DeliveryRow | null {
    const row = this.getState().deliveries.find((item) => item.id === id)
    return row === undefined ? null : clone(row)
  }

  listByContract(contractId: string): DeliveryRow[] {
    return this.getState()
      .deliveries.filter((row) => row.contractId === contractId)
      .map((row) => clone(row))
  }

  insert(row: DeliveryRow): void {
    const state = this.getState()
    const contract = state.contracts.find((item) => item.id === row.contractId)
    if (contract === undefined) {
      throw new LedgerError('NOT_FOUND', `合同不存在：${row.contractId}`, { id: row.contractId })
    }
    if (!Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) {
      throw new LedgerError('VALIDATION_FAILED', '交付金额必须为正整数分。', {
        amountCents: row.amountCents,
      })
    }
    if (state.deliveries.some((item) => item.id === row.id)) {
      throw new LedgerError('VALIDATION_FAILED', `交付明细 id 已存在：${row.id}`, { id: row.id })
    }
    const deliveredCents = deliveredCentsOf(state, row.contractId)
    const remainingCents = contract.amountCents - deliveredCents
    const counted = row.status === 'rejected' ? 0 : row.amountCents
    if (counted > remainingCents) {
      throw new LedgerError('DELIVERY_EXCEEDS_CONTRACT_AMOUNT', '本次交付超过合同剩余可交付金额。', {
        amountCents: contract.amountCents,
        deliveredCents,
        addCents: row.amountCents,
        remainingCents,
      })
    }
    state.deliveries.push(clone(row))
  }

  delete(id: string): void {
    const state = this.getState()
    const index = state.deliveries.findIndex((item) => item.id === id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `交付明细不存在：${id}`, { id })
    }
    state.deliveries.splice(index, 1)
  }
}

/** 人员档案仓储实现。 */
class MemoryPersonnelRepository implements PersonnelRepository {
  constructor(private readonly getState: () => MemoryState) {}

  getById(id: string): PersonnelRow | null {
    const row = this.getState().personnel.find((item) => item.id === id)
    return row === undefined ? null : clone(row)
  }

  list(includeInactive = false): PersonnelRow[] {
    return this.getState()
      .personnel.filter((row) => includeInactive || row.active)
      .map((row) => clone(row))
  }

  insert(row: PersonnelRow): void {
    const state = this.getState()
    if (state.personnel.some((item) => item.id === row.id)) {
      throw new LedgerError('VALIDATION_FAILED', `人员 id 已存在：${row.id}`, { id: row.id })
    }
    state.personnel.push(clone(row))
  }

  update(row: PersonnelRow): void {
    const state = this.getState()
    const index = state.personnel.findIndex((item) => item.id === row.id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `人员不存在：${row.id}`, { id: row.id })
    }
    state.personnel[index] = clone(row)
  }

  delete(id: string): void {
    const state = this.getState()
    const index = state.personnel.findIndex((item) => item.id === id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `人员不存在：${id}`, { id })
    }
    const references = state.contracts.filter((row) => row.ownerId === id).length
    if (references > 0) {
      throw new LedgerError('REFERENCE_IN_USE', '该人员仍负责合同，需先转交后再删除。', {
        entity: 'personnel',
        id,
        references,
      })
    }
    state.personnel.splice(index, 1)
  }
}

/** 字典仓储实现（分类 + 字典项）。 */
class MemoryDictRepository implements DictRepository {
  constructor(private readonly getState: () => MemoryState) {}

  listCategories(): DictCategoryRow[] {
    return this.getState().dictCategories.map((row) => clone(row))
  }

  listItems(categoryCode?: string): DictItemRow[] {
    return this.getState()
      .dictItems.filter((row) => categoryCode === undefined || row.categoryCode === categoryCode)
      .map((row) => clone(row))
  }

  getItemById(id: string): DictItemRow | null {
    const row = this.getState().dictItems.find((item) => item.id === id)
    return row === undefined ? null : clone(row)
  }

  findItem(categoryCode: string, code: string): DictItemRow | null {
    const row = this.getState().dictItems.find(
      (item) => item.categoryCode === categoryCode && item.code === code,
    )
    return row === undefined ? null : clone(row)
  }

  insertCategory(row: DictCategoryRow): void {
    const state = this.getState()
    if (state.dictCategories.some((item) => item.id === row.id)) {
      throw new LedgerError('VALIDATION_FAILED', `字典分类 id 已存在：${row.id}`, { id: row.id })
    }
    if (state.dictCategories.some((item) => item.code === row.code)) {
      throw new LedgerError('VALIDATION_FAILED', `字典分类编码已存在：${row.code}`, {
        code: row.code,
      })
    }
    state.dictCategories.push(clone(row))
  }

  updateCategory(row: DictCategoryRow): void {
    const state = this.getState()
    const index = state.dictCategories.findIndex((item) => item.id === row.id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `字典分类不存在：${row.id}`, { id: row.id })
    }
    const duplicate = state.dictCategories.some(
      (item) => item.id !== row.id && item.code === row.code,
    )
    if (duplicate) {
      throw new LedgerError('VALIDATION_FAILED', `字典分类编码已存在：${row.code}`, {
        code: row.code,
      })
    }
    state.dictCategories[index] = clone(row)
  }

  deleteCategory(id: string): void {
    const state = this.getState()
    const index = state.dictCategories.findIndex((item) => item.id === id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `字典分类不存在：${id}`, { id })
    }
    const category = state.dictCategories[index]
    if (category === undefined) {
      throw new LedgerError('NOT_FOUND', `字典分类不存在：${id}`, { id })
    }
    const items = state.dictItems.filter((item) => item.categoryCode === category.code).length
    if (items > 0) {
      throw new LedgerError('REFERENCE_IN_USE', '该字典分类仍有字典项，需先删除字典项。', {
        entity: 'dictCategory',
        id,
        references: items,
      })
    }
    state.dictCategories.splice(index, 1)
  }

  insertItem(row: DictItemRow): void {
    const state = this.getState()
    const categoryExists = state.dictCategories.some((item) => item.code === row.categoryCode)
    if (!categoryExists) {
      throw new LedgerError('NOT_FOUND', `字典分类不存在：${row.categoryCode}`, {
        categoryCode: row.categoryCode,
      })
    }
    if (state.dictItems.some((item) => item.id === row.id)) {
      throw new LedgerError('VALIDATION_FAILED', `字典项 id 已存在：${row.id}`, { id: row.id })
    }
    const duplicate = state.dictItems.some(
      (item) => item.categoryCode === row.categoryCode && item.code === row.code,
    )
    if (duplicate) {
      throw new LedgerError('VALIDATION_FAILED', `字典项编码已存在：${row.code}`, { code: row.code })
    }
    state.dictItems.push(clone(row))
  }

  updateItem(row: DictItemRow): void {
    const state = this.getState()
    const index = state.dictItems.findIndex((item) => item.id === row.id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `字典项不存在：${row.id}`, { id: row.id })
    }
    const duplicate = state.dictItems.some(
      (item) =>
        item.id !== row.id &&
        item.categoryCode === row.categoryCode &&
        item.code === row.code,
    )
    if (duplicate) {
      throw new LedgerError('VALIDATION_FAILED', `字典项编码已存在：${row.code}`, { code: row.code })
    }
    state.dictItems[index] = clone(row)
  }

  deleteItem(id: string): void {
    const state = this.getState()
    const index = state.dictItems.findIndex((item) => item.id === id)
    if (index < 0) {
      throw new LedgerError('NOT_FOUND', `字典项不存在：${id}`, { id })
    }
    const references = state.contracts.filter(
      (row) => row.typeItemId === id || row.statusItemId === id,
    ).length
    if (references > 0) {
      throw new LedgerError('REFERENCE_IN_USE', '该字典项仍被合同引用，需先改绑后再删除。', {
        entity: 'dictItem',
        id,
        references,
      })
    }
    state.dictItems.splice(index, 1)
  }
}

/**
 * 合同状态日志仓储实现：只追加，不允许修改或删除。
 */
class MemoryContractStatusLogRepository implements ContractStatusLogRepository {
  constructor(private readonly getState: () => MemoryState) {}

  listByContract(contractId: string): ContractStatusLogRow[] {
    return this.getState()
      .statusLogs.filter((row) => row.contractId === contractId)
      .map((row) => clone(row))
  }

  insert(row: ContractStatusLogRow): void {
    const state = this.getState()
    if (state.contracts.every((item) => item.id !== row.contractId)) {
      throw new LedgerError('NOT_FOUND', `合同不存在：${row.contractId}`, { id: row.contractId })
    }
    if (state.statusLogs.some((item) => item.id === row.id)) {
      throw new LedgerError('VALIDATION_FAILED', `状态日志 id 已存在：${row.id}`, { id: row.id })
    }
    state.statusLogs.push(clone(row))
  }
}

/**
 * 创建空内存状态。
 * @returns 版本为 0 的可变状态
 */
function createEmptyState(): MemoryState {
  return {
    contracts: [],
    payments: [],
    deliveries: [],
    personnel: [],
    dictCategories: [],
    dictItems: [],
    statusLogs: [],
    audits: [],
    idempotency: {},
    version: 0,
  }
}

/**
 * 幂等主键：作用域 (actor, command, key)，用 JSON 数组序列化避免分隔符冲突。
 * @param options 写事务选项
 * @returns 幂等表主键
 */
function idempotencyRowKey(options: WriteOptions): string {
  return JSON.stringify([options.actor, options.command, options.idempotencyKey])
}

/**
 * 内存存储：实现 LedgerStore，供命令层单测与 CLI 冒烟使用。
 */
export class MemoryLedgerStore implements LedgerStore {
  private current: MemoryState

  readonly contracts: ContractRepository
  readonly payments: PaymentRepository
  readonly deliveries: DeliveryRepository
  readonly personnel: PersonnelRepository
  readonly dicts: DictRepository
  readonly statusLogs: ContractStatusLogRepository

  constructor() {
    this.current = createEmptyState()
    const getState = (): MemoryState => this.current
    this.contracts = new MemoryContractRepository(getState)
    this.payments = new MemoryPaymentRepository(getState)
    this.deliveries = new MemoryDeliveryRepository(getState)
    this.personnel = new MemoryPersonnelRepository(getState)
    this.dicts = new MemoryDictRepository(getState)
    this.statusLogs = new MemoryContractStatusLogRepository(getState)
  }

  getVersion(): number {
    return this.current.version
  }

  read<T>(fn: () => T): T {
    return fn()
  }

  async write<T>(fn: () => WriteMutation<T>, options: WriteOptions): Promise<WriteResult<T>> {
    const beforeVersion = this.current.version
    const dryRun = options.dryRun === true
    const snapshot = structuredClone(this.current)

    const versionError = checkExpectedVersion(beforeVersion, options.expectedVersion)
    if (versionError !== null) {
      throw new LedgerError(versionError, '数据集版本与期望不一致，请重新读取后再提交。', {
        currentVersion: beforeVersion,
        expectedVersion: options.expectedVersion,
      })
    }

    const rowKey = idempotencyRowKey(options)
    const existing = this.current.idempotency[rowKey]
    if (existing !== undefined) {
      if (existing.fingerprint !== options.inputFingerprint) {
        throw new LedgerError('IDEMPOTENCY_KEY_REUSED', '同一幂等键已用于内容不同的命令。', {
          actor: options.actor,
          command: options.command,
          idempotencyKey: options.idempotencyKey,
        })
      }
      // 同键同指纹：直接重放首次结果，不重复写入、不递增版本。
      return {
        result: structuredClone(existing.result) as T,
        version: existing.version,
        replayed: true,
      }
    }

    try {
      const mutation = await fn()
      const result = structuredClone(mutation.result)

      if (dryRun) {
        // dry-run 只返回将发生的变更：回滚内存快照，不写审计、不递增版本。
        this.current = snapshot
        return { result, version: beforeVersion, diff: mutation.diff, replayed: false }
      }

      const afterVersion = beforeVersion + 1
      const current = this.current
      current.version = afterVersion
      current.idempotency[rowKey] = {
        actor: options.actor,
        command: options.command,
        key: options.idempotencyKey,
        fingerprint: options.inputFingerprint,
        result: structuredClone(mutation.result),
        version: afterVersion,
      }
      current.audits.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        actor: options.actor,
        transport: options.transport ?? 'internal',
        command: options.command,
        idempotencyKey: options.idempotencyKey,
        versionBefore: beforeVersion,
        versionAfter: afterVersion,
        summary: `${options.command} 成功（v${beforeVersion} → v${afterVersion}）`,
      })
      return { result, version: afterVersion, diff: mutation.diff, replayed: false }
    } catch (error) {
      // 任一异常都整体回滚：包含 handler 已插入的部分数据。
      this.current = snapshot
      throw error
    }
  }

  /**
   * 只读快照：深拷贝全部集合，测试可安全断言且不会污染内部状态。
   * @returns 只读状态快照
   */
  state(): MemoryStoreState {
    return {
      contracts: structuredClone(this.current.contracts),
      payments: structuredClone(this.current.payments),
      deliveries: structuredClone(this.current.deliveries),
      personnel: structuredClone(this.current.personnel),
      dictCategories: structuredClone(this.current.dictCategories),
      dictItems: structuredClone(this.current.dictItems),
      statusLogs: structuredClone(this.current.statusLogs),
      audits: structuredClone(this.current.audits),
      idempotency: Object.values(this.current.idempotency).map((row) => structuredClone(row)),
      version: this.current.version,
    }
  }

  /**
   * 重置为空库（版本回到 0），供每个测试独立起点。
   */
  reset(): void {
    this.current = createEmptyState()
  }
}
