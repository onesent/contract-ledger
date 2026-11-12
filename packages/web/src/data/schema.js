/**
 * 前端展示常量与设置默认值。
 *
 * 数据真相在本地服务的 SQLite；本文件只保留 UI 需要的枚举、方向文案、
 * 表格列定义与「只读设置」的默认值合并逻辑（服务端暂无 settings 写命令）。
 */

/**
 * 合同方向（唯一的方向真相，由字段而非字典表达）。
 * @type {{SALE:string, PURCHASE:string}}
 */
export const CONTRACT_DIRECTIONS = Object.freeze({
  SALE: 'sale',
  PURCHASE: 'purchase',
})

/** 方向名称。 */
export const DIRECTION_LABELS = Object.freeze({
  [CONTRACT_DIRECTIONS.SALE]: '销售合同',
  [CONTRACT_DIRECTIONS.PURCHASE]: '采购合同',
})

/** 合同对方称谓。 */
export const PARTY_LABELS = Object.freeze({
  [CONTRACT_DIRECTIONS.SALE]: '客户',
  [CONTRACT_DIRECTIONS.PURCHASE]: '供应商',
})

/**
 * 资金轴文案（按方向取义）。
 * @type {Object<string, {received:string, unpaid:string, progress:string, date:string, verb:string}>}
 */
export const FUNDING_LABELS = Object.freeze({
  [CONTRACT_DIRECTIONS.SALE]: {
    received: '已收金额',
    unpaid: '未收金额',
    progress: '收款进度',
    date: '收款日期',
    verb: '收款',
  },
  [CONTRACT_DIRECTIONS.PURCHASE]: {
    received: '已付金额',
    unpaid: '未付金额',
    progress: '付款进度',
    date: '付款日期',
    verb: '付款',
  },
})

/**
 * 交付验收状态枚举。
 * 这是驱动交付进度计算的固定枚举（rejected 不计入已交付金额），
 * 不是用户可编辑的字典分类，因此不在 dicts 中新增分类。
 */
export const DELIVERY_STATUS = Object.freeze({
  DELIVERED: 'delivered',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
})

/** 交付验收状态的展示元信息（名称 / el-tag type / 色值）。 */
export const DELIVERY_STATUS_META = Object.freeze({
  [DELIVERY_STATUS.DELIVERED]: { name: '已交付', type: 'primary', color: '#409EFF' },
  [DELIVERY_STATUS.ACCEPTED]: { name: '已验收', type: 'success', color: '#67C23A' },
  [DELIVERY_STATUS.REJECTED]: { name: '验收驳回', type: 'danger', color: '#F56C6C' },
})

/**
 * 规范化方向：非法 / 缺失值一律视为销售方向。
 * @param {unknown} value
 * @returns {'sale'|'purchase'}
 */
export function normalizeDirection(value) {
  return value === CONTRACT_DIRECTIONS.PURCHASE ? CONTRACT_DIRECTIONS.PURCHASE : CONTRACT_DIRECTIONS.SALE
}

/** 内置合同状态编码（不可删除，可改名改色）。 */
export const STATUS_CODES = Object.freeze({
  DRAFT: 'draft',
  EXECUTING: 'executing',
  FINISHED: 'finished',
  TERMINATED: 'terminated',
  OVERDUE: 'overdue',
})

/**
 * 合同表格列定义（销售方向默认值，列显隐默认为此为准）。
 * `prop` 同时是列显隐的键，任何方向下都不得改动。
 */
export const CONTRACT_COLUMNS = [
  { prop: 'no', label: '合同编号', width: 150, fixed: true },
  { prop: 'customer', label: '客户名称', minWidth: 180 },
  { prop: 'typeName', label: '合同类型', width: 110 },
  { prop: 'amount', label: '合同金额', width: 140, align: 'right' },
  { prop: 'receivedAmount', label: '已收金额', width: 140, align: 'right' },
  { prop: 'unpaid', label: '未收金额', width: 140, align: 'right' },
  { prop: 'progress', label: '收款进度', width: 170 },
  { prop: 'deliveryProgress', label: '交付进度', width: 170 },
  { prop: 'paymentDate', label: '收款日期', width: 120 },
  { prop: 'signDate', label: '签订日期', width: 120 },
  { prop: 'dueDate', label: '到期日', width: 120 },
  { prop: 'statusName', label: '状态', width: 110 },
  { prop: 'ownerName', label: '负责人', width: 110 },
  { prop: 'statusChangedAt', label: '状态变更时间', width: 170 },
  { prop: 'note', label: '备注', minWidth: 180 },
  { prop: 'createdAt', label: '创建时间', width: 170 },
  { prop: 'updatedAt', label: '更新时间', width: 170 },
]

/**
 * 按方向生成列定义：只替换展示文案，prop / width / align / fixed 保持稳定。
 * @param {'sale'|'purchase'} [direction]
 * @returns {Array<Object>}
 */
export function contractColumns(direction = CONTRACT_DIRECTIONS.SALE) {
  const key = normalizeDirection(direction)
  const funding = FUNDING_LABELS[key]
  const labels = {
    customer: key === CONTRACT_DIRECTIONS.PURCHASE ? '供应商名称' : '客户名称',
    receivedAmount: funding.received,
    unpaid: funding.unpaid,
    progress: funding.progress,
    paymentDate: funding.date,
  }
  return CONTRACT_COLUMNS.map((column) =>
    labels[column.prop] ? { ...column, label: labels[column.prop] } : { ...column },
  )
}

/**
 * 默认设置（与本地服务 seed 的 `settings.app` 同构；不含任何密钥）。
 * @returns {Object}
 */
export function createSettings() {
  const now = new Date().toISOString()
  return {
    id: 'app',
    reminderDays: 30,
    overdueDays: 0,
    staleDays: 90,
    amountPrecision: 2,
    pageSize: 20,
    operatorName: '本机用户',
    autoNo: { enabled: true, pattern: 'HT-YYYYMM-###' },
    autoBackup: { enabled: true, intervalDays: 7 },
    ignoredReminders: [],
    dictCategories: [
      { code: 'contractType', name: '合同类型', builtin: true },
      { code: 'contractStatus', name: '合同状态', builtin: true },
      { code: 'payMethod', name: '付款方式', builtin: true },
      { code: 'department', name: '部门', builtin: true },
    ],
    columnVisibility: Object.fromEntries(CONTRACT_COLUMNS.map((c) => [c.prop, true])),
    ai: {
      enabled: false,
      provider: 'custom',
      baseUrl: '',
      model: '',
      apiKey: '',
      timeout: 30,
      temperature: 0.3,
    },
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 合并设置默认值（幂等）。服务端 seed 的 settings.app 字段可能更少，缺失项按默认补齐。
 * @param {Object} [value]
 * @returns {Object}
 */
export function normalizeSettings(value) {
  const defaults = createSettings()
  if (!value || typeof value !== 'object') return defaults
  return {
    ...defaults,
    ...value,
    id: 'app',
    autoNo: { ...defaults.autoNo, ...(value.autoNo || {}) },
    autoBackup: { ...defaults.autoBackup, ...(value.autoBackup || {}) },
    ai: { ...defaults.ai, ...(value.ai || {}) },
    columnVisibility: { ...defaults.columnVisibility, ...(value.columnVisibility || {}) },
    ignoredReminders: Array.isArray(value.ignoredReminders) ? value.ignoredReminders : [],
    dictCategories:
      Array.isArray(value.dictCategories) && value.dictCategories.length
        ? value.dictCategories
        : defaults.dictCategories,
  }
}
