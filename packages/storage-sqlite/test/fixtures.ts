import type {
  ContractRow,
  DeliveryRow,
  DictCategoryRow,
  DictItemRow,
  PaymentRow,
  PersonnelRow,
} from '@ledger/core'

/** 测试固定时间戳。 */
export const NOW = '2026-01-01T00:00:00.000Z'

/** 字典分类工厂。 */
export function category(id: string, code: string, name: string, sort = 0): DictCategoryRow {
  return { id, code, name, builtin: true, sort, createdAt: NOW, updatedAt: NOW }
}

/** 字典项工厂。 */
export function dictItem(
  id: string,
  categoryCode: string,
  code: string,
  name: string,
  sort = 0,
): DictItemRow {
  return {
    id,
    categoryCode,
    code,
    name,
    color: '',
    sort,
    enabled: true,
    builtin: false,
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** 人员工厂。 */
export function personnelRow(overrides: Partial<PersonnelRow> = {}): PersonnelRow {
  return {
    id: 'person-1',
    code: 'YG-001',
    name: '张伟',
    deptCode: 'sales',
    deptName: '',
    position: '销售经理',
    phone: '13800000001',
    email: 'zhangwei@example.com',
    active: true,
    hireDate: '2021-03-01',
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** 合同工厂：派生字段由视图计算，插入前填 0 占位。 */
export function contractRow(overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    id: 'contract-1',
    no: 'HT-001',
    projectName: '示例项目',
    direction: 'sale',
    counterparty: '示例客户',
    typeItemId: 'item-type-sales',
    typeCode: 'sales',
    typeName: '销售合同',
    statusItemId: 'item-status-executing',
    statusCode: 'executing',
    statusName: '执行中',
    amountCents: 10000,
    openingPaidCents: 0,
    paidCents: 0,
    unpaidCents: 10000,
    receivedAmountCents: 0,
    openingDeliveredCents: 0,
    deliveredCents: 0,
    lastDeliveryDate: null,
    fundingPercent: 0,
    deliveryPercent: 0,
    executionGapCents: 0,
    gapState: 'none',
    ownerId: null,
    ownerName: '',
    note: '',
    signDate: '2026-01-01',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
    statusChangedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** 资金流水工厂。 */
export function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'payment-1',
    contractId: 'contract-1',
    date: '2026-02-01',
    amountCents: 1000,
    methodCode: 'transfer',
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** 交付明细工厂。 */
export function deliveryRow(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: 'delivery-1',
    contractId: 'contract-1',
    date: '2026-03-01',
    amountCents: 1000,
    quantity: null,
    unit: '',
    status: 'delivered',
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}
