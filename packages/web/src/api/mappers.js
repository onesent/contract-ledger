/**
 * API 行 ↔ 旧前端展示行的纯映射。
 *
 * 约定（AGENTS.md 硬约束 2）：服务端金额一律整数分（*_cents），
 * 前端展示层沿用「元」数值；换算只在边界做一次（half-up 到分）。
 * 派生字段（进度 / 未付 / 错位）直接取服务端视图值，前端不重复计算金额。
 */

/**
 * 元 → 整数分（half-up）。
 * @param {unknown} yuan
 * @returns {number}
 */
export function yuanToCents(yuan) {
  const value = Number(yuan)
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100)
}

/**
 * 整数分 → 元（保留 2 位）。
 * 分是整数，除以 100 即精确到分；不可再乘 100（曾经的 ×100/÷100 写法会原值返回，
 * 导致列表与详情把 38,400.00 显示成 3,840,000.00）。
 * @param {unknown} cents
 * @returns {number}
 */
export function centsToYuan(cents) {
  const value = Number(cents)
  if (!Number.isFinite(value)) return 0
  return Math.round(value) / 100
}

/**
 * 合同视图行 → 旧前端合同对象（元 + customer 别名；派生字段取服务端值）。
 * @param {Object} row /api/contracts 或命令返回的 contract
 * @returns {Object}
 */
export function adaptContract(row) {
  return {
    ...row,
    customer: row.counterparty || '',
    amount: centsToYuan(row.amountCents),
    receivedAmount: centsToYuan(row.paidCents),
    deliveredAmount: centsToYuan(row.deliveredCents),
    unpaid: centsToYuan(row.unpaidCents),
    executionGap: centsToYuan(row.executionGapCents),
    paymentDate: row.paymentDate || '',
    lastDeliveryDate: row.lastDeliveryDate || '',
    attachments: [],
    statusLogs: [],
  }
}

/**
 * 资金流水行 → 旧前端流水对象。
 * @param {Object} row
 * @returns {Object}
 */
export function adaptPayment(row) {
  return { ...row, amount: centsToYuan(row.amountCents) }
}

/**
 * 交付明细行 → 旧前端交付对象。
 * @param {Object} row
 * @returns {Object}
 */
export function adaptDelivery(row) {
  return { ...row, amount: centsToYuan(row.amountCents) }
}

/**
 * 状态日志行 → 旧前端日志对象（fromCode/toCode/changedAt/actor → from/to/at/by）。
 * @param {Object} row
 * @returns {Object}
 */
export function adaptStatusLog(row) {
  return {
    id: row.id,
    contractId: row.contractId,
    from: row.fromCode || null,
    to: row.toCode || '',
    at: row.changedAt || '',
    by: row.actor || '—',
    note: row.note || '',
  }
}

/**
 * 字典项行 → 旧前端字典对象（categoryCode → category）。
 * @param {Object} row
 * @returns {Object}
 */
export function adaptDictItem(row) {
  return {
    id: row.id,
    category: row.categoryCode,
    code: row.code,
    name: row.name,
    color: row.color || '#909399',
    sort: Number(row.sort) || 0,
    enabled: row.enabled !== false,
    builtin: row.builtin === true,
    note: row.note || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * 字典分类行 → 旧前端分类对象。
 * @param {Object} row
 * @returns {{code:string, name:string, builtin:boolean, id:string, sort:number}}
 */
export function adaptDictCategory(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    builtin: row.builtin === true,
    sort: Number(row.sort) || 0,
  }
}

/**
 * 服务端统计（整数分）→ 旧前端统计对象（元；paymentRate / deliveryRate 即资金 / 交付百分比）。
 * @param {Object} summary StatsSummary
 * @param {string} direction sale / purchase
 * @returns {Object}
 */
export function adaptStats(summary, direction) {
  return {
    direction,
    contractCount: summary.contractCount,
    totalAmount: centsToYuan(summary.totalAmountCents),
    receivedAmount: centsToYuan(summary.receivedAmountCents),
    deliveredAmount: centsToYuan(summary.deliveredAmountCents),
    unpaidAmount: centsToYuan(summary.unpaidAmountCents),
    paymentRate: summary.fundingPercent === null ? null : summary.fundingPercent,
    deliveryRate: summary.deliveryPercent === null ? null : summary.deliveryPercent,
    executingCount: summary.executingCount,
    monthSignedCount: summary.monthSignedCount,
    monthSignedAmount: centsToYuan(summary.monthSignedAmountCents),
    dueSoonCount: summary.dueSoonCount,
    overdueCount: summary.overdueCount,
    overdueUnpaidAmount: centsToYuan(summary.overdueUnpaidAmountCents),
    paymentCount: summary.paymentCount,
    statusCounts: summary.statusCounts || {},
  }
}

/**
 * 服务端提醒项 → 旧前端提醒项（counterparty → customer，unpaidCents → 元）。
 * @param {Object} item
 * @returns {Object}
 */
export function adaptReminderItem(item) {
  return {
    id: item.id,
    no: item.no || '',
    customer: item.counterparty || '',
    dueDate: item.dueDate || '',
    ownerName: item.ownerName || '',
    unpaid: centsToYuan(item.unpaidCents),
    issues: Array.isArray(item.issues) ? item.issues : [],
    ignoreKey: item.ignoreKey || '',
  }
}

/**
 * 服务端提醒分组 → 旧前端分组结构。
 * 服务端分组 type 使用 'error'，el-tag 合法值为 'danger'，此处映射。
 * @param {Object} group
 * @returns {Object}
 */
export function adaptReminder(group) {
  return {
    key: group.key,
    title: group.title,
    type: group.type === 'error' ? 'danger' : group.type,
    quick: group.quick,
    description: group.description,
    count: Number(group.count) || 0,
    totalCount: Number(group.totalCount) || 0,
    ignoredCount: Number(group.ignoredCount) || 0,
    items: (group.items || []).map(adaptReminderItem),
  }
}
