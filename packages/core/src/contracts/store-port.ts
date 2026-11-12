import type { Transport } from './envelope.js'
import type {
  ContractDirection,
  ContractRow,
  DeliveryRow,
  DictCategoryRow,
  DictItemRow,
  PaymentRow,
  PersonnelRow,
} from './api-shapes.js'

/** 合同列表查询的最小过滤条件。 */
export interface ContractListQuery {
  direction?: ContractDirection
  statusCode?: string
  ownerId?: string
  search?: string
  limit?: number
  offset?: number
}

/** 合同仓储：只暴露核心命令需要的读写方法。 */
export interface ContractRepository {
  getById(id: string): ContractRow | null
  getByNo(no: string): ContractRow | null
  list(query?: ContractListQuery): ContractRow[]
  insert(row: ContractRow): void
  update(row: ContractRow): void
  delete(id: string): void
}

/** 资金流水仓储。 */
export interface PaymentRepository {
  getById(id: string): PaymentRow | null
  listByContract(contractId: string): PaymentRow[]
  insert(row: PaymentRow): void
  delete(id: string): void
}

/** 交付明细仓储。 */
export interface DeliveryRepository {
  getById(id: string): DeliveryRow | null
  listByContract(contractId: string): DeliveryRow[]
  insert(row: DeliveryRow): void
  delete(id: string): void
}

/** 合同状态变更日志。 */
export interface ContractStatusLogRow {
  id: string
  contractId: string
  fromCode: string
  toCode: string
  changedAt: string
  actor: string
  note: string
}

/** 状态日志仓储：只追加，不修改、不删除。 */
export interface ContractStatusLogRepository {
  listByContract(contractId: string): ContractStatusLogRow[]
  insert(row: ContractStatusLogRow): void
}

/** 人员档案仓储。 */
export interface PersonnelRepository {
  getById(id: string): PersonnelRow | null
  list(includeInactive?: boolean): PersonnelRow[]
  insert(row: PersonnelRow): void
  update(row: PersonnelRow): void
  delete(id: string): void
}

/** 字典仓储（分类 + 项）。 */
export interface DictRepository {
  listCategories(): DictCategoryRow[]
  listItems(categoryCode?: string): DictItemRow[]
  getItemById(id: string): DictItemRow | null
  findItem(categoryCode: string, code: string): DictItemRow | null
  insertCategory(row: DictCategoryRow): void
  updateCategory(row: DictCategoryRow): void
  deleteCategory(id: string): void
  insertItem(row: DictItemRow): void
  updateItem(row: DictItemRow): void
  deleteItem(id: string): void
}

/** 写事务选项；command 参与幂等键作用域 (actor, command, idempotencyKey)。 */
export interface WriteOptions {
  actor: string
  command: string
  idempotencyKey: string
  /** SHA-256(canonical JSON input)；同一幂等键不同指纹视为误用。 */
  inputFingerprint: string
  expectedVersion?: number
  dryRun?: boolean
  /** 审计来源通道；内部调用默认 internal。 */
  transport?: Transport
}

/** 写事务内部产生的业务结果与字段级差异。 */
export interface WriteMutation<T> {
  result: T
  diff?: unknown
}

/** 写事务返回：新版本号、结果、差异；replayed 表示命中幂等重放。 */
export interface WriteResult<T> {
  result: T
  version: number
  diff?: unknown
  replayed: boolean
}

/**
 * 存储端口：核心命令只依赖此接口，in-memory 与 SQLite 实现必须行为一致。
 * read 在只读快照内执行；write 在单事务内执行并递增数据集版本。
 */
export interface LedgerStore {
  read<T>(fn: () => T): T
  write<T>(fn: () => WriteMutation<T>, options: WriteOptions): Promise<WriteResult<T>>
  getVersion(): number
  readonly contracts: ContractRepository
  readonly payments: PaymentRepository
  readonly deliveries: DeliveryRepository
  readonly personnel: PersonnelRepository
  readonly dicts: DictRepository
  readonly statusLogs: ContractStatusLogRepository
}
