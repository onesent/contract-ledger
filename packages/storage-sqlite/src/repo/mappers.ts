import type { Insertable, Selectable } from 'kysely'
import type {
  ContractRow,
  DeliveryRow,
  DictCategoryRow,
  DictItemRow,
  PaymentRow,
  PersonnelRow,
} from '@ledger/core'
import type { DB } from '../generated/db.js'

/**
 * 数据库行 → 契约行映射。
 * 约定：金额列已在 SQL 中为整数分；布尔列以 0/1 存储，这里还原为 boolean。
 *
 * 读取行使用 Kysely `Selectable`（把 Generated<T> 还原为 T 的可读类型）；
 * 写入对象使用 `Insertable`（把有默认值的列标记为可选）。
 */

/** 合同事实表读取行。 */
export type ContractRecord = Selectable<DB['contracts']>
/** 合同事实表插入对象。 */
export type ContractInsert = Insertable<DB['contracts']>
/** 合同全量视图读取行。 */
export type ContractViewRecord = Selectable<DB['v_contract_full']>
/** 资金流水读取行。 */
export type PaymentRecord = Selectable<DB['payments']>
/** 交付明细读取行。 */
export type DeliveryRecord = Selectable<DB['deliveries']>
/** 人员读取行。 */
export type PersonnelRecord = Selectable<DB['personnel']>
/** 字典分类读取行。 */
export type DictCategoryRecord = Selectable<DB['dict_categories']>
/** 字典项读取行。 */
export type DictItemRecord = Selectable<DB['dict_items']>

/** 视图行 → 合同行（含派生金额与进度）。 */
export function toContractRow(row: ContractViewRecord): ContractRow {
  return {
    id: row.id,
    no: row.no,
    projectName: row.project_name,
    direction: row.direction,
    counterparty: row.counterparty,
    typeItemId: row.type_item_id,
    typeCode: row.type_code,
    typeName: row.type_name,
    statusItemId: row.status_item_id,
    statusCode: row.status_code,
    statusName: row.status_name,
    amountCents: row.amount_cents,
    openingPaidCents: row.opening_paid_cents,
    paidCents: row.paid_cents,
    unpaidCents: row.unpaid_cents,
    receivedAmountCents: row.paid_cents,
    openingDeliveredCents: row.opening_delivered_cents,
    deliveredCents: row.delivered_cents,
    lastDeliveryDate: row.last_delivery_date,
    fundingPercent: row.funding_percent,
    deliveryPercent: row.delivery_percent,
    executionGapCents: row.execution_gap_cents,
    gapState: row.gap_state,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    note: row.note,
    signDate: row.sign_date,
    startDate: row.start_date,
    dueDate: row.due_date,
    statusChangedAt: row.status_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 资金流水行 → 契约行。 */
export function toPaymentRow(row: PaymentRecord): PaymentRow {
  return {
    id: row.id,
    contractId: row.contract_id,
    date: row.date,
    amountCents: row.amount_cents,
    methodCode: row.method_code,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 交付明细行 → 契约行。 */
export function toDeliveryRow(row: DeliveryRecord): DeliveryRow {
  return {
    id: row.id,
    contractId: row.contract_id,
    date: row.date,
    amountCents: row.amount_cents,
    quantity: row.quantity,
    unit: row.unit,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 人员行 → 契约行；部门名称由字典查询补全（personnel 只存 department_code）。
 * @param row 人员表行
 * @param departmentName 部门字典名称，未匹配时为空串
 */
export function toPersonnelRow(row: PersonnelRecord, departmentName: string): PersonnelRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    deptCode: row.department_code,
    deptName: departmentName,
    position: row.position,
    phone: row.phone,
    email: row.email,
    active: row.active === 1,
    hireDate: row.hire_date,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 字典分类行 → 契约行。 */
export function toDictCategoryRow(row: DictCategoryRecord): DictCategoryRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    builtin: row.builtin === 1,
    sort: row.sort,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 字典项行 → 契约行（categoryCode 由分类表 join 或显式传入）。 */
export function toDictItemRow(row: DictItemRecord, categoryCode: string): DictItemRow {
  return {
    id: row.id,
    categoryCode,
    code: row.code,
    name: row.name,
    color: row.color,
    sort: row.sort,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
