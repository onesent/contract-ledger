/**
 * 跨传输层共享的 API 行 / 视图类型。
 * 约定：金额一律为整数分（cents）；业务日期为 YYYY-MM-DD；时间戳为 ISO-8601。
 * 命名保持 camelCase，与旧版前端字段对齐（receivedAmountCents 是 paidCents 的兼容别名）。
 */

/** 业务日期（YYYY-MM-DD）。 */
export type IsoDate = string

/** ISO-8601 时间戳（UTC）。 */
export type IsoTimestamp = string

/** 合同方向：销售 / 采购。 */
export type ContractDirection = 'sale' | 'purchase'

/** 交付验收状态：已交付 / 已验收 / 验收驳回（rejected 不计入已交付金额）。 */
export type DeliveryStatus = 'delivered' | 'accepted' | 'rejected'

/** 资金与交付的错位状态。 */
export type GapState = 'none' | 'balanced' | 'prepaid' | 'receivable'

/** 合同行 / 视图：视图在行基础上由 SQL 视图实时补齐派生金额与进度。 */
export interface ContractRow {
  id: string
  no: string
  projectName: string
  direction: ContractDirection
  counterparty: string
  typeItemId: string
  typeCode: string
  typeName: string
  statusItemId: string
  statusCode: string
  statusName: string
  amountCents: number
  openingPaidCents: number
  paidCents: number
  unpaidCents: number
  /** paidCents 的旧前端兼容别名。 */
  receivedAmountCents: number
  openingDeliveredCents: number
  deliveredCents: number
  lastDeliveryDate: IsoDate | null
  fundingPercent: number | null
  deliveryPercent: number | null
  executionGapCents: number
  gapState: GapState
  ownerId: string | null
  ownerName: string
  note: string
  signDate: IsoDate
  startDate: IsoDate
  dueDate: IsoDate
  statusChangedAt: IsoTimestamp | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

/** 合同视图与行字段一致；保留别名以便后续视图扩展。 */
export type ContractView = ContractRow

/** 资金流水行。 */
export interface PaymentRow {
  id: string
  contractId: string
  date: IsoDate
  amountCents: number
  methodCode: string
  note: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

/** 资金流水视图：补全合同编号与付款方式名称。 */
export interface PaymentView extends PaymentRow {
  contractNo: string
  methodName: string
}

/** 交付执行明细行。 */
export interface DeliveryRow {
  id: string
  contractId: string
  date: IsoDate
  amountCents: number
  quantity: number | null
  unit: string
  status: DeliveryStatus
  note: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

/** 交付执行明细视图：补全合同编号。 */
export interface DeliveryView extends DeliveryRow {
  contractNo: string
}

/** 人员档案行。 */
export interface PersonnelRow {
  id: string
  code: string
  name: string
  deptCode: string
  deptName: string
  position: string
  phone: string
  email: string
  active: boolean
  hireDate: IsoDate | null
  note: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

/** 字典分类行。 */
export interface DictCategoryRow {
  id: string
  code: string
  name: string
  builtin: boolean
  sort: number
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

/** 字典项行。 */
export interface DictItemRow {
  id: string
  categoryCode: string
  code: string
  name: string
  color: string
  sort: number
  enabled: boolean
  builtin: boolean
  note: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

/** 首页统计摘要（金额为整数分；进度为 0–100，合同金额为 0 时为 null）。 */
export interface StatsSummary {
  direction: ContractDirection | 'all'
  contractCount: number
  totalAmountCents: number
  receivedAmountCents: number
  deliveredAmountCents: number
  unpaidAmountCents: number
  fundingPercent: number | null
  deliveryPercent: number | null
  executingCount: number
  monthSignedCount: number
  monthSignedAmountCents: number
  dueSoonCount: number
  overdueCount: number
  overdueUnpaidAmountCents: number
  paymentCount: number
}

/** 提醒清单中的单条合同摘要。 */
export interface ReminderItem {
  id: string
  no: string
  counterparty: string
  dueDate: IsoDate
  ownerName: string
  unpaidCents: number
  issues: string[]
  ignoreKey: string
}

/** 提醒分组。 */
export interface Reminder {
  key: string
  title: string
  type: 'warning' | 'error' | 'info'
  quick: string
  description: string
  count: number
  totalCount: number
  ignoredCount: number
  items: ReminderItem[]
}

/** 服务端分页 / 筛选 / 排序参数。 */
export interface PageQuery {
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  direction?: ContractDirection
  statusCode?: string
  ownerId?: string
  search?: string
}

/** 服务端分页结果。 */
export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
