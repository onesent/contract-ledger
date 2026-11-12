import type { ContractRow, DeliveryRow, PaymentRow, PersonnelRow } from '@ledger/core'

/** 备份应用标识（与旧版前端一致）。 */
export const DATASET_APP = 'contract-ledger' as const

/** 当前导出的数据结构版本。 */
export const DATASET_SCHEMA_VERSION = 3 as const

/** 可导入的历史 / 当前 schema 版本。 */
export type DatasetSchemaVersion = 1 | 2 | 3

/** 导出 / 导入的字典项行（沿用旧版扁平 `category` 字段，便于与 v1/v2 备份互通）。 */
export interface DatasetDictRow {
  id: string
  category: string
  code: string
  name: string
  sort: number
  enabled: boolean
  color: string
  builtin: boolean
  note: string
  createdAt: string
  updatedAt: string
}

/** 完整导出数据集；合同为视图行（含派生字段）。 */
export interface DatasetExport {
  app: typeof DATASET_APP
  schemaVersion: typeof DATASET_SCHEMA_VERSION
  exportedAt: string
  data: {
    contracts: ContractRow[]
    payments: PaymentRow[]
    deliveries: DeliveryRow[]
    personnel: PersonnelRow[]
    dicts: DatasetDictRow[]
    settings: Record<string, unknown>
  }
}

/** 导入选项。 */
export interface ImportOptions {
  /** 状态日志缺少操作者时的兜底操作人。 */
  actor?: string
  /** 注入当前时间（测试用）；缺省为系统时间。 */
  now?: Date
  /** 替换（默认）或按 id 合并。 */
  mode?: 'replace' | 'merge'
}

/** 导入结果：各集合实际写入条数与跳过记录。 */
export interface ImportReport {
  contracts: number
  payments: number
  deliveries: number
  personnel: number
  dicts: number
  skipped: number
  warnings: string[]
}

/** 旧版状态日志（v1/v2）或导出状态日志（v3）的宽松输入形状。 */
export interface LegacyStatusLog {
  id?: unknown
  contractId?: unknown
  from?: unknown
  fromCode?: unknown
  to?: unknown
  toCode?: unknown
  at?: unknown
  changedAt?: unknown
  by?: unknown
  actor?: unknown
  note?: unknown
}

/** 旧版合同（v1/v2）与 v3 导出合同的并集形状；字段全部可选以便宽松解析。 */
export interface LegacyContract {
  id?: unknown
  no?: unknown
  projectName?: unknown
  customer?: unknown
  counterparty?: unknown
  direction?: unknown
  typeCode?: unknown
  statusCode?: unknown
  amount?: unknown
  amountCents?: unknown
  receivedAmount?: unknown
  receivedAmountCents?: unknown
  paidCents?: unknown
  openingPaidCents?: unknown
  deliveredAmount?: unknown
  deliveredCents?: unknown
  openingDeliveredCents?: unknown
  paymentDate?: unknown
  lastDeliveryDate?: unknown
  signDate?: unknown
  startDate?: unknown
  dueDate?: unknown
  ownerId?: unknown
  ownerName?: unknown
  statusChangedAt?: unknown
  note?: unknown
  attachments?: unknown
  statusLogs?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/** 旧版 / 导出资金流水。 */
export interface LegacyPayment {
  id?: unknown
  contractId?: unknown
  amount?: unknown
  amountCents?: unknown
  date?: unknown
  methodCode?: unknown
  note?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/** 旧版 / 导出交付明细。 */
export interface LegacyDelivery {
  id?: unknown
  contractId?: unknown
  amount?: unknown
  amountCents?: unknown
  date?: unknown
  quantity?: unknown
  unit?: unknown
  status?: unknown
  note?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/** 旧版 / 导出人员档案。 */
export interface LegacyPersonnel {
  id?: unknown
  code?: unknown
  name?: unknown
  deptCode?: unknown
  departmentCode?: unknown
  deptName?: unknown
  position?: unknown
  phone?: unknown
  email?: unknown
  active?: unknown
  hireDate?: unknown
  note?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/** 旧版 / 导出字典项。 */
export interface LegacyDict {
  id?: unknown
  category?: unknown
  categoryCode?: unknown
  code?: unknown
  name?: unknown
  sort?: unknown
  enabled?: unknown
  color?: unknown
  builtin?: unknown
  note?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/** 旧版 settings.dictCategories 中的分类元信息。 */
export interface LegacyDictCategory {
  code?: unknown
  name?: unknown
  builtin?: unknown
}

/** 旧版 / 导出数据集 data 部分。 */
export interface LegacyDatasetData {
  contracts?: unknown
  payments?: unknown
  deliveries?: unknown
  personnel?: unknown
  dicts?: unknown
  settings?: unknown
}

/** 旧版 / 导出备份根对象。 */
export interface LegacyDatasetPayload {
  app?: unknown
  schemaVersion?: unknown
  exportedAt?: unknown
  data?: LegacyDatasetData
}
