import dayjs from 'dayjs'
import { STATUS_CODES, normalizeDirection } from '../data/schema'
import { isFiniteNumber, roundMoney, toNumber } from './format'

/**
 * @typedef {Object} Contract
 * @property {string} id
 * @property {string} no
 * @property {string} customer
 * @property {'sale'|'purchase'} [direction]
 * @property {string} typeCode
 * @property {number} amount
 * @property {number} receivedAmount
 * @property {number} [deliveredAmount]
 * @property {string} [lastDeliveryDate]
 * @property {string} [paymentDate]
 * @property {string} signDate
 * @property {string} [startDate]
 * @property {string} dueDate
 * @property {string} statusCode
 * @property {string} ownerId
 * @property {string} [ownerName]
 * @property {string} [statusChangedAt]
 * @property {string} [note]
 * @property {Array<Object>} [attachments]
 * @property {Array<Object>} [statusLogs]
 */

/**
 * 未收金额 = 合同金额 − 已收金额（不小于 0 的展示口径）。
 * @param {Contract} contract
 * @returns {number}
 */
export function unpaidAmount(contract) {
  const amount = toNumber(contract?.amount, 0)
  const received = toNumber(contract?.receivedAmount, 0)
  return roundMoney(Math.max(0, amount - received), 4)
}

/**
 * 资金进度（0~100）：已收/已付金额占合同金额的比例，合同金额 ≤ 0 时返回 null，调用方显示「—」。
 * @param {Contract} contract
 * @returns {number|null}
 */
export function fundingPercent(contract) {
  const amount = toNumber(contract?.amount, 0)
  const received = toNumber(contract?.receivedAmount, 0)
  if (!isFiniteNumber(amount) || amount <= 0) return null
  const percent = (received / amount) * 100
  if (!Number.isFinite(percent)) return null
  return Math.min(100, Math.max(0, roundMoney(percent, 2)))
}

/**
 * 交付进度（0~100）：已交付金额占合同金额的比例，合同金额 ≤ 0 时返回 null。
 * @param {Contract} contract
 * @returns {number|null}
 */
export function deliveryPercent(contract) {
  const amount = toNumber(contract?.amount, 0)
  const delivered = toNumber(contract?.deliveredAmount, 0)
  if (!isFiniteNumber(amount) || amount <= 0) return null
  const percent = (delivered / amount) * 100
  if (!Number.isFinite(percent)) return null
  return Math.min(100, Math.max(0, roundMoney(percent, 2)))
}

/**
 * 错位差额 = 已收/已付金额 − 已交付金额（正数表示资金先行，负数表示交付先行）。
 * @param {Contract} contract
 * @returns {number}
 */
export function executionGap(contract) {
  const received = toNumber(contract?.receivedAmount, 0)
  const delivered = toNumber(contract?.deliveredAmount, 0)
  return roundMoney(received - delivered, 2)
}

/**
 * 错位状态：none（无金额或均未发生）/ balanced（无差额）/ prepaid（资金先行）/ receivable（交付先行）。
 * 调用方按方向把 prepaid 映射为预收/预付、receivable 映射为已交付未收款/已到货未付款。
 * @param {Contract} contract
 * @returns {'none'|'balanced'|'prepaid'|'receivable'}
 */
export function gapState(contract) {
  const amount = toNumber(contract?.amount, 0)
  const received = toNumber(contract?.receivedAmount, 0)
  const delivered = toNumber(contract?.deliveredAmount, 0)
  if (amount <= 0 || (received === 0 && delivered === 0)) return 'none'
  const gap = roundMoney(received - delivered, 2)
  if (gap === 0) return 'balanced'
  return gap > 0 ? 'prepaid' : 'receivable'
}

/**
 * 收款状态：zero / none / partial / full
 * @param {Contract} contract
 * @returns {'zero'|'none'|'partial'|'full'}
 */
export function paymentState(contract) {
  const amount = toNumber(contract?.amount, 0)
  const received = toNumber(contract?.receivedAmount, 0)
  if (amount <= 0) return received > 0 ? 'full' : 'zero'
  if (received <= 0) return 'none'
  if (received >= amount) return 'full'
  return 'partial'
}

/**
 * 合同日期的兜底开始日：开始日期为空时取签订日期。
 * @param {Contract} contract
 * @returns {string|undefined}
 */
export function effectiveStartDate(contract) {
  return contract?.startDate || contract?.signDate || undefined
}

/**
 * 状态是否属于「流程已结束」。
 * @param {string} statusCode
 * @param {Array<Object>} [dicts]
 * @returns {boolean}
 */
export function isClosedStatus(statusCode, dicts = []) {
  const item = dicts.find((d) => d.category === 'contractStatus' && d.code === statusCode)
  if (item && typeof item.closed === 'boolean') return item.closed
  return statusCode === STATUS_CODES.FINISHED || statusCode === STATUS_CODES.TERMINATED
}

/**
 * 相对今天的天数差（正数=未来）。
 * @param {string} date
 * @param {import('dayjs').Dayjs} [today]
 * @returns {number|null}
 */
export function daysFromToday(date, today = dayjs()) {
  if (!date) return null
  const d = dayjs(date)
  if (!d.isValid()) return null
  return d.startOf('day').diff(today.startOf('day'), 'day')
}

/**
 * 是否临期（含今天，截止 today + N 天）。
 * @param {Contract} contract
 * @param {number} reminderDays
 * @param {Array<Object>} [dicts]
 * @param {import('dayjs').Dayjs} [today]
 * @returns {boolean}
 */
export function isDueSoon(contract, reminderDays = 30, dicts = [], today = dayjs()) {
  const diff = daysFromToday(contract?.dueDate, today)
  if (diff === null) return false
  if (isClosedStatus(contract.statusCode, dicts)) return false
  return diff >= 0 && diff <= toNumber(reminderDays, 30)
}

/**
 * 是否已逾期（到期日已过且状态不是完结/终止）。
 * @param {Contract} contract
 * @param {Array<Object>} [dicts]
 * @param {import('dayjs').Dayjs} [today]
 * @returns {boolean}
 */
export function isOverdue(contract, dicts = [], today = dayjs()) {
  const diff = daysFromToday(contract?.dueDate, today)
  if (diff === null) return false
  if (isClosedStatus(contract.statusCode, dicts)) return false
  return diff < 0
}

/**
 * 逾期未收：有未收金额，且「最近收款日 / 到期日 + 逾期判定天数」已过。
 * @param {Contract} contract
 * @param {number} overdueDays
 * @param {Array<Object>} [dicts]
 * @param {import('dayjs').Dayjs} [today]
 * @returns {boolean}
 */
export function isOverdueUnpaid(contract, overdueDays = 0, dicts = [], today = dayjs()) {
  if (unpaidAmount(contract) <= 0) return false
  if (isClosedStatus(contract.statusCode, dicts)) return false
  const base = contract?.paymentDate || contract?.dueDate
  const diff = daysFromToday(base, today)
  if (diff === null) return false
  return diff < -toNumber(overdueDays, 0)
}

/**
 * 超期未交付：合同金额大于 0、未完结、已过到期日且交付进度未达 100%。
 * @param {Contract} contract
 * @param {Array<Object>} [dicts]
 * @param {import('dayjs').Dayjs} [today]
 * @returns {boolean}
 */
export function isOverdueDelivery(contract, dicts = [], today = dayjs()) {
  if (toNumber(contract?.amount, 0) <= 0) return false
  if (isClosedStatus(contract?.statusCode, dicts)) return false
  const percent = deliveryPercent(contract)
  if (percent === null || percent >= 100) return false
  const diff = daysFromToday(contract?.dueDate, today)
  return diff !== null && diff < 0
}

/**
 * 已交付未收/付款：仍有未收/未付金额、已交付金额大于 0，且距最后交付日超过逾期判定天数。
 * @param {Contract} contract
 * @param {number} overdueDays
 * @param {Array<Object>} [dicts]
 * @param {import('dayjs').Dayjs} [today]
 * @returns {boolean}
 */
export function isDeliveredUnpaid(contract, overdueDays = 0, dicts = [], today = dayjs()) {
  if (unpaidAmount(contract) <= 0) return false
  if (toNumber(contract?.deliveredAmount, 0) <= 0) return false
  if (isClosedStatus(contract?.statusCode, dicts)) return false
  const diff = daysFromToday(contract?.lastDeliveryDate, today)
  if (diff === null) return false
  return diff < -toNumber(overdueDays, 0)
}

/**
 * 预收/预付未交付：已收/已付金额大于已交付金额，且合同未完结。
 * @param {Contract} contract
 * @param {Array<Object>} [dicts]
 * @returns {boolean}
 */
export function isPrepaidUndelivered(contract, dicts = []) {
  if (isClosedStatus(contract?.statusCode, dicts)) return false
  return toNumber(contract?.receivedAmount, 0) > toNumber(contract?.deliveredAmount, 0)
}

/**
 * 数据质量异常：日期缺失 / 日期先后颠倒 / 金额非法 / 已收超合同金额。
 * @param {Contract} contract
 * @returns {string[]} 异常原因列表
 */
export function dataQualityIssues(contract) {
  const issues = []
  if (!contract?.dueDate) issues.push('到期日缺失')
  if (!contract?.signDate) issues.push('签订日期缺失')
  if (contract?.signDate && contract?.dueDate && dayjs(contract.dueDate).isBefore(dayjs(contract.signDate))) {
    issues.push('到期日早于签订日期')
  }
  const start = effectiveStartDate(contract)
  if (start && contract?.dueDate && dayjs(contract.dueDate).isBefore(dayjs(start))) {
    issues.push('到期日早于开始日期')
  }
  if (!isFiniteNumber(contract?.amount) || Number(contract.amount) < 0) issues.push('合同金额非法')
  if (!isFiniteNumber(contract?.receivedAmount) || Number(contract.receivedAmount) < 0) {
    issues.push('已收金额非法')
  }
  if (toNumber(contract?.receivedAmount, 0) > toNumber(contract?.amount, 0)) {
    issues.push('已收金额大于合同金额')
  }
  if (contract?.statusChangedAt && !dayjs(contract.statusChangedAt).isValid()) {
    issues.push('状态变更时间非法')
  }
  return issues
}

/**
 * 状态长期未变更（执行中且超过 N 天没变化）。
 * @param {Contract} contract
 * @param {number} staleDays
 * @param {import('dayjs').Dayjs} [today]
 * @returns {boolean}
 */
export function isStaleStatus(contract, staleDays = 90, today = dayjs()) {
  if (contract?.statusCode !== STATUS_CODES.EXECUTING) return false
  const last = contract?.statusChangedAt || contract?.updatedAt || contract?.createdAt
  const diff = daysFromToday(last, today)
  if (diff === null) return false
  return -diff > toNumber(staleDays, 90)
}

/**
 * 快捷筛选定义：首页统计卡与提醒清单跳转时复用，保证口径一致。
 * @type {Array<{value:string,label:string,description:string}>}
 */
export const QUICK_FILTERS = [
  { value: 'all', label: '全部合同', description: '不做任何快捷筛选' },
  { value: 'dueSoon', label: '临期合同', description: '到期日在提醒天数内且未完结' },
  { value: 'overdue', label: '已逾期', description: '已过到期日且状态非完结/终止' },
  { value: 'overdueUnpaid', label: '逾期未收', description: '存在未收金额且超过逾期判定天数' },
  { value: 'zeroReceived', label: '执行中未收款', description: '已开始执行但已收金额为 0' },
  { value: 'stale', label: '长期未变更', description: '执行中且状态超过设定天数未变化' },
  { value: 'invalid', label: '数据质量异常', description: '日期逻辑或金额字段异常' },
  { value: 'unpaid', label: '有未收金额', description: '未收金额大于 0' },
  { value: 'received', label: '已产生收款', description: '已收金额大于 0' },
  { value: 'deliveredUnfunded', label: '已交付未收款', description: '已交付金额大于 0 且仍有未收金额' },
  { value: 'fundedUndelivered', label: '已收款未交付', description: '已收金额大于已交付金额（资金先行）' },
  { value: 'executing', label: '执行中', description: '状态为执行中' },
  { value: 'finished', label: '已完结', description: '状态为已完结' },
  { value: 'monthSigned', label: '本月新签', description: '签订日期在本月' },
]

/**
 * 判断合同是否命中某个快捷筛选。
 * @param {Contract} contract
 * @param {string} quick
 * @param {Object} settings
 * @param {Array<Object>} [dicts]
 * @param {import('dayjs').Dayjs} [today]
 * @returns {boolean}
 */
export function matchesQuick(contract, quick, settings = {}, dicts = [], today = dayjs()) {
  if (!quick || quick === 'all') return true
  const reminderDays = toNumber(settings.reminderDays, 30)
  const overdueDays = toNumber(settings.overdueDays, 0)
  const staleDays = toNumber(settings.staleDays, 90)
  switch (quick) {
    case 'dueSoon':
      return isDueSoon(contract, reminderDays, dicts, today)
    case 'overdue':
      return isOverdue(contract, dicts, today)
    case 'overdueUnpaid':
      return isOverdueUnpaid(contract, overdueDays, dicts, today)
    case 'zeroReceived':
      return (
        contract.statusCode === STATUS_CODES.EXECUTING &&
        toNumber(contract.receivedAmount, 0) === 0 &&
        toNumber(contract.amount, 0) > 0
      )
    case 'stale':
      return isStaleStatus(contract, staleDays, today)
    case 'invalid':
      return dataQualityIssues(contract).length > 0
    case 'unpaid':
      return unpaidAmount(contract) > 0
    case 'received':
      return toNumber(contract.receivedAmount, 0) > 0
    case 'deliveredUnfunded':
      return toNumber(contract.deliveredAmount, 0) > 0 && unpaidAmount(contract) > 0
    case 'fundedUndelivered':
      return (
        toNumber(contract.receivedAmount, 0) > 0 &&
        toNumber(contract.receivedAmount, 0) > toNumber(contract.deliveredAmount, 0)
      )
    case 'overdueDelivery':
      return isOverdueDelivery(contract, dicts, today)
    case 'prepaidUndelivered':
      return isPrepaidUndelivered(contract, dicts)
    case 'executing':
      return contract.statusCode === STATUS_CODES.EXECUTING
    case 'finished':
      return contract.statusCode === STATUS_CODES.FINISHED
    case 'monthSigned':
      return !!contract.signDate && dayjs(contract.signDate).isSame(today, 'month')
    default:
      return true
  }
}

/**
 * 提醒分组定义（顺序即页面展示顺序）。
 * @type {Array<{key:string,title:string,type:'warning'|'error'|'info',quick:string,description:string}>}
 */
export const REMINDER_GROUPS = [
  {
    key: 'dueSoon',
    title: '即将到期',
    type: 'warning',
    quick: 'dueSoon',
    description: '到期日在提醒天数内且尚未完结',
  },
  {
    key: 'overdue',
    title: '已逾期合同',
    type: 'error',
    quick: 'overdue',
    description: '已过到期日且状态非已完结/已终止',
  },
  {
    key: 'overdueUnpaid',
    title: '逾期未收款',
    type: 'error',
    quick: 'overdueUnpaid',
    description: '有未收金额且超过逾期判定天数',
  },
  {
    key: 'zeroReceived',
    title: '执行中未收款',
    type: 'warning',
    quick: 'zeroReceived',
    description: '已开始执行但已收金额为 0',
  },
  {
    key: 'stale',
    title: '长期未变更状态',
    type: 'info',
    quick: 'stale',
    description: '执行中且状态超过设定天数未变化',
  },
  {
    key: 'dataQuality',
    title: '数据质量异常',
    type: 'info',
    quick: 'invalid',
    description: '到期日缺失或日期/金额逻辑异常',
  },
  {
    key: 'overdueDelivery',
    title: '超期未交付',
    type: 'error',
    quick: 'overdueDelivery',
    description: '已过到期日且交付进度未达 100%',
  },
  {
    key: 'deliveredUnpaid',
    title: '已交付未收/付款',
    type: 'warning',
    quick: 'deliveredUnfunded',
    description: '存在未收/未付金额且已交付金额大于 0，超过逾期判定天数未收到资金',
  },
  {
    key: 'prepaidUndelivered',
    title: '预收款/预付款未交付',
    type: 'info',
    quick: 'fundedUndelivered',
    description: '已收/已付金额大于已交付金额且合同未完结',
  },
]

/**
 * 计算提醒清单（纯函数，被首页与列表共用）。
 * @param {Object} payload
 * @param {Contract[]} payload.contracts
 * @param {Object} payload.settings
 * @param {Array<Object>} payload.dicts
 * @param {string[]} [payload.ignored]
 * @param {import('dayjs').Dayjs} [payload.today]
 * @param {'sale'|'purchase'} [payload.direction] 传入时只统计该方向合同
 * @returns {Array<Object>}
 */
export function computeReminders({
  contracts = [],
  settings = {},
  dicts = [],
  ignored = [],
  today = dayjs(),
  direction = '',
}) {
  const ignoredSet = new Set(ignored || [])
  const scoped = direction ? contracts.filter((c) => normalizeDirection(c.direction) === direction) : contracts
  return REMINDER_GROUPS.map((group) => {
    const matched = scoped.filter((c) => matchesQuick(c, group.quick, settings, dicts, today))
    const visible = matched.filter((c) => !ignoredSet.has(`${group.key}:${c.id}`))
    return {
      ...group,
      count: visible.length,
      totalCount: matched.length,
      ignoredCount: matched.length - visible.length,
      items: visible.slice(0, 8).map((c) => ({
        id: c.id,
        no: c.no,
        customer: c.customer,
        dueDate: c.dueDate,
        ownerName: c.ownerName,
        unpaid: unpaidAmount(c),
        issues: group.key === 'dataQuality' ? dataQualityIssues(c) : [],
        ignoreKey: `${group.key}:${c.id}`,
      })),
      quick: group.quick,
    }
  })
}

/**
 * 首页统计（全部为实时计算，不落库）。
 * 传入 direction 时只统计该方向合同；收款条数同样只统计该方向合同产生的流水。
 * @param {Object} payload
 * @param {Contract[]} payload.contracts
 * @param {Array<Object>} payload.payments
 * @param {Object} payload.settings
 * @param {Array<Object>} payload.dicts
 * @param {import('dayjs').Dayjs} [payload.today]
 * @param {'sale'|'purchase'} [payload.direction]
 * @returns {Object}
 */
export function computeStats({
  contracts = [],
  payments = [],
  settings = {},
  dicts = [],
  today = dayjs(),
  direction = '',
}) {
  const scopedContracts = direction
    ? contracts.filter((c) => normalizeDirection(c.direction) === direction)
    : contracts
  const scopedPayments = direction
    ? payments.filter((p) => {
        const contract = contracts.find((c) => c.id === p.contractId)
        return contract ? normalizeDirection(contract.direction) === direction : false
      })
    : payments
  const totalAmount = scopedContracts.reduce((sum, c) => sum + toNumber(c.amount, 0), 0)
  const receivedAmount = scopedContracts.reduce((sum, c) => sum + toNumber(c.receivedAmount, 0), 0)
  const deliveredAmount = scopedContracts.reduce((sum, c) => sum + toNumber(c.deliveredAmount, 0), 0)
  const unpaidTotal = scopedContracts.reduce((sum, c) => sum + unpaidAmount(c), 0)
  const executing = scopedContracts.filter((c) => c.statusCode === STATUS_CODES.EXECUTING)
  const monthSigned = scopedContracts.filter((c) => c.signDate && dayjs(c.signDate).isSame(today, 'month'))
  const dueSoon = scopedContracts.filter((c) => isDueSoon(c, settings.reminderDays, dicts, today))
  const overdue = scopedContracts.filter((c) => isOverdue(c, dicts, today))
  const overdueUnpaidList = scopedContracts.filter((c) => isOverdueUnpaid(c, settings.overdueDays, dicts, today))
  const paymentRate = totalAmount > 0 ? (receivedAmount / totalAmount) * 100 : null
  const deliveryRate = totalAmount > 0 ? (deliveredAmount / totalAmount) * 100 : null

  return {
    direction: direction || 'all',
    contractCount: scopedContracts.length,
    totalAmount: roundMoney(totalAmount, 2),
    receivedAmount: roundMoney(receivedAmount, 2),
    deliveredAmount: roundMoney(deliveredAmount, 2),
    unpaidAmount: roundMoney(unpaidTotal, 2),
    paymentRate: paymentRate === null ? null : roundMoney(Math.min(100, Math.max(0, paymentRate)), 2),
    deliveryRate: deliveryRate === null ? null : roundMoney(Math.min(100, Math.max(0, deliveryRate)), 2),
    executingCount: executing.length,
    monthSignedCount: monthSigned.length,
    monthSignedAmount: roundMoney(
      monthSigned.reduce((sum, c) => sum + toNumber(c.amount, 0), 0),
      2,
    ),
    dueSoonCount: dueSoon.length,
    overdueCount: overdue.length,
    overdueUnpaidAmount: roundMoney(
      overdueUnpaidList.reduce((sum, c) => sum + unpaidAmount(c), 0),
      2,
    ),
    paymentCount: scopedPayments.length,
  }
}

/**
 * 近 N 个月签约/收款趋势（含当前月）。
 * @param {Object} payload
 * @param {Contract[]} payload.contracts
 * @param {Array<Object>} payload.payments
 * @param {number} [payload.months]
 * @param {import('dayjs').Dayjs} [payload.today]
 * @param {'sale'|'purchase'} [payload.direction] 传入时只统计该方向的合同与对应流水
 * @returns {{labels:string[], signed:number[], received:number[]}}
 */
export function monthlyTrend({ contracts = [], payments = [], months = 12, today = dayjs(), direction = '' }) {
  const contractMap = new Map(contracts.map((c) => [c.id, c]))
  const scopedContracts = direction
    ? contracts.filter((c) => normalizeDirection(c.direction) === direction)
    : contracts
  const scopedPayments = direction
    ? payments.filter((p) => {
        const contract = contractMap.get(p.contractId)
        return contract ? normalizeDirection(contract.direction) === direction : false
      })
    : payments
  const labels = []
  const keys = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = today.subtract(i, 'month')
    keys.push(d.format('YYYY-MM'))
    labels.push(d.format('YYYY-MM'))
  }
  const signed = keys.map((key) =>
    roundMoney(
      scopedContracts
        .filter((c) => c.signDate && dayjs(c.signDate).format('YYYY-MM') === key)
        .reduce((sum, c) => sum + toNumber(c.amount, 0), 0),
      2,
    ),
  )
  const received = keys.map((key) =>
    roundMoney(
      scopedPayments
        .filter((p) => p.date && dayjs(p.date).format('YYYY-MM') === key)
        .reduce((sum, p) => sum + toNumber(p.amount, 0), 0),
      2,
    ),
  )
  return { labels, signed, received }
}

/**
 * 按字段分组汇总金额与数量。
 * @param {Contract[]} contracts
 * @param {'typeCode'|'statusCode'} field
 * @param {Array<Object>} dicts
 * @param {'sale'|'purchase'} [direction] 传入时只统计该方向合同
 * @returns {Array<{code:string,name:string,color:string,count:number,amount:number}>}
 */
export function groupByDict(contracts, field, dicts, direction = '') {
  const list = direction ? contracts.filter((c) => normalizeDirection(c.direction) === direction) : contracts
  /** @type {Map<string, {code:string,name:string,color:string,count:number,amount:number}>} */
  const map = new Map()
  for (const c of list) {
    const code = c[field] || 'unknown'
    if (!map.has(code)) {
      const dict = dicts.find((d) => d.category === (field === 'typeCode' ? 'contractType' : 'contractStatus') && d.code === code)
      map.set(code, {
        code,
        name: dict?.name || (code === 'unknown' ? '未填写' : code),
        color: dict?.color || '#909399',
        count: 0,
        amount: 0,
      })
    }
    const entry = map.get(code)
    entry.count += 1
    entry.amount = roundMoney(entry.amount + toNumber(c.amount, 0), 2)
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

/**
 * 逾期天数（便于展示，已完结返回 0）。
 * @param {Contract} contract
 * @param {Array<Object>} [dicts]
 * @param {import('dayjs').Dayjs} [today]
 * @returns {number}
 */
export function overdueDaysOf(contract, dicts = [], today = dayjs()) {
  if (!isOverdue(contract, dicts, today)) return 0
  return Math.abs(daysFromToday(contract.dueDate, today) || 0)
}
