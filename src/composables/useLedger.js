import { computed, inject, provide } from 'vue'
import dayjs from 'dayjs'
import {
  ENGINE,
  ENGINE_LABELS,
  applyChanges,
  countsOf,
  data,
  recheckStorage,
  refreshUsage,
  retryWrite,
  snapshot,
  status,
} from '../data/store'
import {
  CONTRACT_COLUMNS,
  CONTRACT_DIRECTIONS,
  DELIVERY_STATUS,
  DELIVERY_STATUS_META,
  DIRECTION_LABELS,
  FUNDING_LABELS,
  PARTY_LABELS,
  STATUS_CODES,
  contractColumns,
  createDemoDataset,
  emptyDataset,
  normalizeDirection,
  normalizeSettings,
} from '../data/schema'
import {
  downloadSnapshot,
  exportBackup as exportBackupFile,
  importBackup as importBackupFile,
  parseBackupText,
  sanitizeSettingsForBackup,
} from '../data/backup'
import { nowIso, uuid } from '../utils/id'
import { formatMoney, isFiniteNumber, roundMoney, toNumber } from '../utils/format'
import {
  QUICK_FILTERS,
  REMINDER_GROUPS,
  computeReminders,
  computeStats,
  dataQualityIssues,
  deliveryPercent,
  executionGap,
  fundingPercent,
  gapState,
  groupByDict,
  isDueSoon,
  isOverdue,
  isStaleStatus,
  matchesQuick,
  monthlyTrend,
  overdueDaysOf,
  paymentState,
  unpaidAmount,
} from '../utils/derive'
import { isConfigured as isAiConfigured } from '../ai/provider'

/** provide / inject 键。 */
export const LEDGER_KEY = Symbol('contract-ledger')

/**
 * @param {string} value
 * @returns {string}
 */
function text(value) {
  return value === null || value === undefined ? '' : String(value).trim()
}

/**
 * 生成合同编号（遵循设置中的规则，可手工覆盖）。
 * @param {Array<Object>} contracts
 * @param {Object} settings
 * @returns {string}
 */
export function generateContractNo(contracts, settings) {
  const rule = settings?.autoNo || {}
  if (rule.enabled === false) return ''
  const pattern = text(rule.pattern) || 'HT-YYYYMM-###'
  const now = dayjs()
  const filled = pattern
    .replace(/YYYY/g, now.format('YYYY'))
    .replace(/MM/g, now.format('MM'))
    .replace(/DD/g, now.format('DD'))
  const index = filled.indexOf('###')
  if (index < 0) return filled
  const prefix = filled.slice(0, index)
  const suffix = filled.slice(index + 3)
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escape(prefix)}(\\d+)${escape(suffix)}$`)
  let max = 0
  for (const contract of contracts) {
    const match = regex.exec(String(contract.no || ''))
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}${suffix}`
}

/**
 * 创建台账访问对象（在 App.vue 中创建并 provide 给整棵组件树）。
 * @returns {Object}
 */
export function createLedger() {
  const settings = computed(() => data.settings)
  const meta = computed(() => data.meta)
  const precision = computed(() => Number(data.settings.amountPrecision) || 2)

  // ---------- 字典 ----------
  const dictsByCategory = computed(() => {
    /** @type {Record<string, Array<Object>>} */
    const map = {}
    for (const dict of data.dicts) {
      if (!map[dict.category]) map[dict.category] = []
      map[dict.category].push(dict)
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => toNumber(a.sort, 0) - toNumber(b.sort, 0) || String(a.name).localeCompare(String(b.name), 'zh'))
    }
    return map
  })

  /** 仅启用项（用于录入表单下拉）。 */
  const dictOptions = computed(() => {
    /** @type {Record<string, Array<Object>>} */
    const map = {}
    for (const [category, list] of Object.entries(dictsByCategory.value)) {
      map[category] = list.filter((item) => item.enabled !== false)
    }
    return map
  })

  /** 全部字典项（历史数据展示用，含停用项）。 */
  const dictLookup = computed(() => {
    /** @type {Map<string, Object>} */
    const map = new Map()
    for (const dict of data.dicts) map.set(`${dict.category}:${dict.code}`, dict)
    return map
  })

  const dictCategories = computed(() => data.settings.dictCategories || [])
  const statusDicts = computed(() => dictsByCategory.value.contractStatus || [])
  const statusMap = computed(() => {
    /** @type {Map<string, Object>} */
    const map = new Map()
    for (const dict of statusDicts.value) map.set(dict.code, dict)
    return map
  })

  // ---------- 人员 ----------
  const personnelLookup = computed(() => {
    /** @type {Map<string, Object>} */
    const map = new Map()
    for (const person of data.personnel) map.set(person.id, person)
    return map
  })
  const activePersonnel = computed(() =>
    data.personnel
      .filter((person) => person.active !== false)
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh')),
  )
  const personnelOptions = computed(() =>
    activePersonnel.value.map((person) => {
      const dept = dictLookup.value.get(`department:${person.deptCode}`)
      return {
        value: person.id,
        label: person.name,
        code: person.code,
        deptName: dept?.name || person.deptCode || '',
        position: person.position || '',
      }
    }),
  )

  // ---------- 合同派生视图 ----------
  const enrich = (contract) => {
    const type = dictLookup.value.get(`contractType:${contract.typeCode}`)
    const state = statusMap.value.get(contract.statusCode)
    const owner = personnelLookup.value.get(contract.ownerId)
    return {
      ...contract,
      direction: normalizeDirection(contract.direction),
      typeName: type?.name || contract.typeCode || '—',
      typeColor: type?.color || '#909399',
      statusName: state?.name || contract.statusCode || '—',
      statusColor: state?.color || '#909399',
      ownerName: contract.ownerName || owner?.name || '—',
      ownerActive: owner ? owner.active !== false : false,
      unpaid: unpaidAmount(contract),
      deliveredAmount: roundMoney(toNumber(contract.deliveredAmount, 0), precision.value),
      lastDeliveryDate: contract.lastDeliveryDate || '',
      fundingPercent: fundingPercent(contract),
      deliveryPercent: deliveryPercent(contract),
      executionGap: executionGap(contract),
      gapState: gapState(contract),
      paymentState: paymentState(contract),
      deliveryState: paymentState({ ...contract, receivedAmount: contract.deliveredAmount }),
      overdue: isOverdue(contract, data.dicts),
      dueSoon: isDueSoon(contract, data.settings.reminderDays, data.dicts),
      stale: isStaleStatus(contract, data.settings.staleDays),
      overdueDays: overdueDaysOf(contract, data.dicts),
      issues: dataQualityIssues(contract),
    }
  }

  const contracts = computed(() => data.contracts.map(enrich))

  /** 按方向分组的合同（派生对象，供销售 / 采购两个入口直接消费）。 */
  const contractsByDirection = computed(() => {
    /** @type {{sale:Array<Object>, purchase:Array<Object>}} */
    const grouped = { [CONTRACT_DIRECTIONS.SALE]: [], [CONTRACT_DIRECTIONS.PURCHASE]: [] }
    for (const contract of contracts.value) {
      if (contract.direction === CONTRACT_DIRECTIONS.PURCHASE) grouped[CONTRACT_DIRECTIONS.PURCHASE].push(contract)
      else grouped[CONTRACT_DIRECTIONS.SALE].push(contract)
    }
    return grouped
  })

  const customerSuggestions = computed(() => {
    const set = new Set()
    for (const contract of data.contracts) {
      if (text(contract.customer)) set.add(contract.customer)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
  })

  // ---------- 统计 / 提醒 / 图表 ----------
  const stats = computed(() =>
    computeStats({
      contracts: data.contracts,
      payments: data.payments,
      settings: data.settings,
      dicts: data.dicts,
    }),
  )

  const ignoredKeys = computed(() =>
    (data.settings.ignoredReminders || []).map((item) => (typeof item === 'string' ? item : item.key)).filter(Boolean),
  )

  const reminders = computed(() =>
    computeReminders({
      contracts: data.contracts,
      settings: data.settings,
      dicts: data.dicts,
      ignored: ignoredKeys.value,
    }),
  )

  const reminderTotal = computed(() => reminders.value.reduce((sum, group) => sum + group.count, 0))

  const trend = computed(() =>
    monthlyTrend({ contracts: data.contracts, payments: data.payments, months: 12 }),
  )
  const typeDistribution = computed(() => groupByDict(data.contracts, 'typeCode', data.dicts))
  const statusDistribution = computed(() => groupByDict(data.contracts, 'statusCode', data.dicts))

  // ---------- 方向维度派生视图（销售 / 采购分别计算，不合并金额） ----------
  const statsFor = (direction) =>
    computeStats({
      contracts: data.contracts,
      payments: data.payments,
      settings: data.settings,
      dicts: data.dicts,
      direction,
    })

  const remindersFor = (direction) =>
    computeReminders({
      contracts: data.contracts,
      settings: data.settings,
      dicts: data.dicts,
      ignored: ignoredKeys.value,
      direction,
    })

  const trendFor = (direction) =>
    monthlyTrend({ contracts: data.contracts, payments: data.payments, months: 12, direction })

  const statsByDirection = computed(() => ({
    [CONTRACT_DIRECTIONS.SALE]: statsFor(CONTRACT_DIRECTIONS.SALE),
    [CONTRACT_DIRECTIONS.PURCHASE]: statsFor(CONTRACT_DIRECTIONS.PURCHASE),
  }))

  const remindersByDirection = computed(() => ({
    [CONTRACT_DIRECTIONS.SALE]: remindersFor(CONTRACT_DIRECTIONS.SALE),
    [CONTRACT_DIRECTIONS.PURCHASE]: remindersFor(CONTRACT_DIRECTIONS.PURCHASE),
  }))

  const trendByDirection = computed(() => ({
    [CONTRACT_DIRECTIONS.SALE]: trendFor(CONTRACT_DIRECTIONS.SALE),
    [CONTRACT_DIRECTIONS.PURCHASE]: trendFor(CONTRACT_DIRECTIONS.PURCHASE),
  }))

  const typeDistributionByDirection = computed(() => ({
    [CONTRACT_DIRECTIONS.SALE]: groupByDict(
      data.contracts,
      'typeCode',
      data.dicts,
      CONTRACT_DIRECTIONS.SALE,
    ),
    [CONTRACT_DIRECTIONS.PURCHASE]: groupByDict(
      data.contracts,
      'typeCode',
      data.dicts,
      CONTRACT_DIRECTIONS.PURCHASE,
    ),
  }))

  const statusDistributionByDirection = computed(() => ({
    [CONTRACT_DIRECTIONS.SALE]: groupByDict(
      data.contracts,
      'statusCode',
      data.dicts,
      CONTRACT_DIRECTIONS.SALE,
    ),
    [CONTRACT_DIRECTIONS.PURCHASE]: groupByDict(
      data.contracts,
      'statusCode',
      data.dicts,
      CONTRACT_DIRECTIONS.PURCHASE,
    ),
  }))

  /**
   * 某合同的交付执行明细（按交付日期倒序，供详情抽屉直接渲染）。
   * @param {string} contractId
   * @returns {Array<Object>}
   */
  function deliveriesFor(contractId) {
    return (data.deliveries || [])
      .filter((item) => item.contractId === contractId)
      .slice()
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      })
  }

  /** 方向名称：销售合同 / 采购合同。 */
  function directionLabel(direction) {
    return DIRECTION_LABELS[normalizeDirection(direction)]
  }

  /** 对方称谓：客户 / 供应商。 */
  function partyLabel(direction) {
    return PARTY_LABELS[normalizeDirection(direction)]
  }

  /** 资金轴标签：{ received, unpaid, progress, date, verb }。 */
  function fundingLabels(direction) {
    return { ...FUNDING_LABELS[normalizeDirection(direction)] }
  }

  /** 某方向的表格列定义（prop 与销售默认一致）。 */
  function columnsFor(direction) {
    return contractColumns(normalizeDirection(direction))
  }

  const backupDue = computed(() => {
    const rule = data.settings.autoBackup || {}
    if (rule.enabled === false) return false
    if (data.contracts.length === 0) return false
    const last = data.meta?.lastBackupAt
    if (!last || !dayjs(last).isValid()) return true
    return dayjs().diff(dayjs(last), 'day') >= (toNumber(rule.intervalDays, 7) || 7)
  })

  const storageInfo = computed(() => ({
    engine: status.engine,
    engineLabel: ENGINE_LABELS[status.engine] || status.engine,
    writable: status.writable,
    portable: status.portable,
    idbAvailable: status.idbAvailable,
    idbError: status.idbError,
    writeError: status.writeError,
    lastError: status.lastError,
    usage: status.usage,
    counts: countsOf(data),
    settingsCount: 1,
    metaCount: 1,
  }))

  const aiConfig = computed(() => data.settings.ai || {})
  const aiReady = computed(() => isAiConfigured(data.settings.ai))

  // ---------- 领域操作 ----------
  const operator = () => text(data.settings.operatorName) || '本机用户'

  /**
   * 构造合同记录（含状态日志、负责人姓名快照、方向锁定与金额下限校验）。
   * @param {Object} input
   * @returns {{ok:boolean, record?:Object, message?:string, code?:string}}
   */
  function buildContractRecord(input) {
    const existing = input?.id ? data.contracts.find((item) => item.id === input.id) : null
    if (input?.id && !existing) {
      return { ok: false, code: 'NOT_FOUND', message: '合同不存在或已被删除' }
    }
    const direction = text(input.direction) || normalizeDirection(existing?.direction)
    if (direction !== CONTRACT_DIRECTIONS.SALE && direction !== CONTRACT_DIRECTIONS.PURCHASE) {
      return { ok: false, code: 'DIRECTION_INVALID', message: '合同方向只能是销售或采购' }
    }
    if (existing && normalizeDirection(existing.direction) !== direction) {
      // 方向锁定：已有资金流水或交付明细的合同不允许翻转方向，避免统计口径错位
      const hasPayments = data.payments.some((item) => item.contractId === existing.id)
      const hasDeliveries = (data.deliveries || []).some((item) => item.contractId === existing.id)
      if (hasPayments || hasDeliveries) {
        return { ok: false, code: 'DIRECTION_LOCKED', message: '该合同已有执行记录，方向不可更改' }
      }
    }
    const ownerId = text(input.ownerId)
    const owner = personnelLookup.value.get(ownerId)
    if (!owner) return { ok: false, code: 'OWNER_NOT_FOUND', message: '负责人不存在，请重新选择' }
    if (owner.active === false && (!existing || existing.ownerId !== ownerId)) {
      return { ok: false, code: 'OWNER_INACTIVE', message: '该负责人已离职，不能指派新合同' }
    }
    const now = nowIso()
    const log = Array.isArray(existing?.statusLogs) ? existing.statusLogs.slice() : []
    const statusChanged = !existing || existing.statusCode !== input.statusCode
    if (statusChanged) {
      log.push({
        id: uuid(),
        from: existing?.statusCode ?? null,
        to: input.statusCode,
        at: now,
        by: operator(),
      })
    }
    const amount = roundMoney(toNumber(input.amount, 0), precision.value)
    const received = roundMoney(toNumber(input.receivedAmount, 0), precision.value)
    // 已交付金额只能由交付明细维护，保存时一律沿用库中汇总值
    const delivered = roundMoney(toNumber(existing?.deliveredAmount, 0), precision.value)
    const record = {
      id: existing?.id || uuid(),
      no: text(input.no),
      customer: text(input.customer),
      direction,
      typeCode: text(input.typeCode),
      amount,
      receivedAmount: received,
      paymentDate: text(input.paymentDate) || text(existing?.paymentDate),
      deliveredAmount: delivered,
      lastDeliveryDate: existing?.lastDeliveryDate || '',
      signDate: text(input.signDate),
      startDate: text(input.startDate) || text(input.signDate),
      dueDate: text(input.dueDate),
      statusCode: text(input.statusCode),
      ownerId,
      ownerName: owner.name,
      // 新建时不视为「变更」，保持为空；只有真正改变状态才记录时间
      statusChangedAt: statusChanged ? (existing ? now : null) : existing?.statusChangedAt || null,
      note: text(input.note),
      attachments: Array.isArray(input.attachments) ? input.attachments : existing?.attachments || [],
      statusLogs: log,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    if (!record.no) return { ok: false, code: 'NO_EMPTY', message: '合同编号不能为空' }
    if (!record.customer) return { ok: false, code: 'CUSTOMER_EMPTY', message: '客户名称不能为空' }
    if (!record.typeCode) return { ok: false, code: 'TYPE_EMPTY', message: '请选择合同类型' }
    if (!record.signDate) return { ok: false, code: 'SIGN_DATE_EMPTY', message: '请选择签订日期' }
    if (!record.dueDate) return { ok: false, code: 'DUE_DATE_EMPTY', message: '请选择到期日' }
    if (record.dueDate < (record.startDate || record.signDate)) {
      return { ok: false, code: 'DATE_ORDER', message: '到期日不能早于开始日期' }
    }
    if (amount < received) {
      return {
        ok: false,
        code: 'AMOUNT_BELOW_RECEIVED',
        message: `合同金额不能低于已收/已付金额，还差 ${formatMoney(received - amount, precision.value)}`,
      }
    }
    if (amount < delivered) {
      return {
        ok: false,
        code: 'AMOUNT_BELOW_DELIVERED',
        message: `合同金额不能低于已交付金额，还差 ${formatMoney(delivered - amount, precision.value)}`,
      }
    }
    return { ok: true, record }
  }

  /**
   * 保存合同（新增 / 编辑）。
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async function saveContract(input) {
    const prepared = buildContractRecord(input)
    if (!prepared.ok) return prepared
    const result = await applyChanges({ put: { contracts: [prepared.record] } })
    if (!result.ok) return result
    return { ok: true, contract: prepared.record, created: !input?.id }
  }

  /**
   * 复制新增：返回草稿（不写库）。
   * @param {Object} contract
   * @returns {Object}
   */
  function copyContract(contract) {
    return {
      ...contract,
      id: '',
      no: generateContractNo(data.contracts, data.settings),
      statusCode: STATUS_CODES.DRAFT,
      receivedAmount: 0,
      paymentDate: '',
      deliveredAmount: 0,
      lastDeliveryDate: '',
      statusChangedAt: null,
      statusLogs: [],
      attachments: [],
      createdAt: '',
      updatedAt: '',
    }
  }

  /**
   * 批量删除合同（同一次事务删除关联收款流水与交付明细）。
   * @param {string[]} ids
   * @returns {Promise<Object>}
   */
  async function deleteContracts(ids) {
    const set = new Set(ids || [])
    if (!set.size) return { ok: false, message: '未选择合同' }
    const paymentIds = data.payments.filter((payment) => set.has(payment.contractId)).map((payment) => payment.id)
    const deliveryIds = (data.deliveries || [])
      .filter((delivery) => set.has(delivery.contractId))
      .map((delivery) => delivery.id)
    const result = await applyChanges({
      remove: { contracts: [...set], payments: paymentIds, deliveries: deliveryIds },
    })
    if (!result.ok) return result
    return { ok: true, contracts: set.size, payments: paymentIds.length, deliveries: deliveryIds.length }
  }

  /**
   * 批量修改状态 / 负责人。
   * @param {string[]} ids
   * @param {{statusCode?:string, ownerId?:string}} patch
   * @returns {Promise<Object>}
   */
  async function bulkUpdate(ids, patch) {
    const set = new Set(ids || [])
    if (!set.size) return { ok: false, message: '未选择合同' }
    if (!patch?.statusCode && !patch?.ownerId) return { ok: false, message: '没有需要修改的字段' }
    const owner = patch.ownerId ? personnelLookup.value.get(patch.ownerId) : null
    if (patch.ownerId && !owner) return { ok: false, message: '负责人不存在' }
    if (owner && owner.active === false) return { ok: false, message: '该负责人已离职，不能指派' }

    const now = nowIso()
    const updated = []
    let statusChanges = 0
    let ownerChanges = 0
    for (const contract of data.contracts) {
      if (!set.has(contract.id)) continue
      let next = contract
      if (patch.statusCode && patch.statusCode !== contract.statusCode) {
        const logs = Array.isArray(contract.statusLogs) ? contract.statusLogs.slice() : []
        logs.push({
          id: uuid(),
          from: contract.statusCode,
          to: patch.statusCode,
          at: now,
          by: operator(),
        })
        next = { ...next, statusCode: patch.statusCode, statusChangedAt: now, statusLogs: logs }
        statusChanges += 1
      }
      if (patch.ownerId && patch.ownerId !== contract.ownerId) {
        next = { ...next, ownerId: patch.ownerId, ownerName: owner.name }
        ownerChanges += 1
      }
      if (next !== contract) updated.push(next)
    }
    if (!updated.length) return { ok: false, message: '没有发生变化' }
    const result = await applyChanges({ put: { contracts: updated } })
    if (!result.ok) return result
    return { ok: true, count: updated.length, statusChanges, ownerChanges }
  }

  /**
   * 登记收款：追加流水并累加合同已收金额（同一次事务写入）。
   * @param {{contractId:string, amount:number, date:string, note?:string, methodCode?:string}} input
   * @returns {Promise<Object>}
   */
  async function registerPayment(input) {
    const contract = data.contracts.find((item) => item.id === input?.contractId)
    if (!contract) return { ok: false, message: '合同不存在' }
    const amount = roundMoney(toNumber(input.amount, 0), precision.value)
    if (!(amount > 0)) return { ok: false, message: '收款金额必须大于 0' }
    const remaining = roundMoney(
      toNumber(contract.amount, 0) - toNumber(contract.receivedAmount, 0),
      precision.value,
    )
    if (amount > remaining + 1e-9) {
      return { ok: false, message: `本次收款不能超过剩余未收金额 ${formatMoney(remaining, precision.value)}` }
    }
    const date = text(input.date)
    if (!date) return { ok: false, message: '请选择收款日期' }
    const now = nowIso()
    const payment = {
      id: uuid(),
      contractId: contract.id,
      amount,
      date,
      note: text(input.note),
      methodCode: text(input.methodCode),
      createdAt: now,
      updatedAt: now,
    }
    const nextPaymentDate =
      contract.paymentDate && dayjs(contract.paymentDate).isAfter(dayjs(date)) ? contract.paymentDate : date
    const nextContract = {
      ...contract,
      receivedAmount: roundMoney(toNumber(contract.receivedAmount, 0) + amount, precision.value),
      paymentDate: nextPaymentDate,
    }
    const result = await applyChanges({ put: { payments: [payment], contracts: [nextContract] } })
    if (!result.ok) return result
    return { ok: true, payment, contract: nextContract }
  }

  /**
   * 删除一条收款流水，并回退合同已收金额 / 收款日期。
   * @param {string} paymentId
   * @returns {Promise<Object>}
   */
  async function deletePayment(paymentId) {
    const payment = data.payments.find((item) => item.id === paymentId)
    if (!payment) return { ok: false, message: '收款记录不存在' }
    const contract = data.contracts.find((item) => item.id === payment.contractId)
    if (!contract) return { ok: false, message: '关联合同不存在' }
    const rest = data.payments.filter((item) => item.contractId === contract.id && item.id !== paymentId)
    const latest = rest.map((item) => item.date).filter(Boolean).sort().at(-1) || ''
    const nextContract = {
      ...contract,
      receivedAmount: roundMoney(
        Math.max(0, toNumber(contract.receivedAmount, 0) - toNumber(payment.amount, 0)),
        precision.value,
      ),
      paymentDate: latest,
    }
    const result = await applyChanges({
      remove: { payments: [paymentId] },
      put: { contracts: [nextContract] },
    })
    if (!result.ok) return result
    return { ok: true, contract: nextContract }
  }

  /**
   * 登记交付执行明细：追加明细并累加合同已交付金额（同一次事务写入）。
   * 验收驳回（rejected）的明细保留可追溯，但不计入已交付金额。
   * @param {{contractId:string, date:string, amount:number, quantity?:number|null, unit?:string, status?:string, note?:string}} input
   * @returns {Promise<Object>}
   */
  async function registerDelivery(input) {
    const contract = data.contracts.find((item) => item.id === input?.contractId)
    if (!contract) return { ok: false, message: '合同不存在' }
    const amount = roundMoney(toNumber(input.amount, 0), precision.value)
    if (!(amount > 0)) return { ok: false, message: '交付金额必须大于 0' }
    const delivered = roundMoney(toNumber(contract.deliveredAmount, 0), precision.value)
    const remaining = roundMoney(toNumber(contract.amount, 0) - delivered, precision.value)
    if (amount > remaining + 1e-9) {
      return { ok: false, message: `本次交付不能超过剩余可交付金额 ${formatMoney(remaining, precision.value)}` }
    }
    const date = text(input.date)
    if (!date) return { ok: false, message: '请选择交付日期' }
    const status = text(input.status) || DELIVERY_STATUS.DELIVERED
    if (!Object.values(DELIVERY_STATUS).includes(status)) {
      return { ok: false, code: 'DELIVERY_STATUS_INVALID', message: '交付验收状态不合法' }
    }
    const quantity = isFiniteNumber(input.quantity) ? Number(input.quantity) : null
    const now = nowIso()
    const delivery = {
      id: uuid(),
      contractId: contract.id,
      date,
      amount,
      quantity,
      unit: text(input.unit),
      status,
      note: text(input.note),
      createdAt: now,
      updatedAt: now,
    }
    const counted = status !== DELIVERY_STATUS.REJECTED
    const lastDeliveryDate =
      counted && (!contract.lastDeliveryDate || dayjs(date).isAfter(dayjs(contract.lastDeliveryDate)))
        ? date
        : contract.lastDeliveryDate || ''
    const nextContract = {
      ...contract,
      deliveredAmount: counted ? roundMoney(delivered + amount, precision.value) : delivered,
      lastDeliveryDate,
    }
    const result = await applyChanges({ put: { deliveries: [delivery], contracts: [nextContract] } })
    if (!result.ok) return result
    return { ok: true, delivery, contract: nextContract }
  }

  /**
   * 删除一条交付明细，并按剩余明细重算已交付金额与最后交付日期。
   * 重算而非减法，保证连续删除后汇总始终与明细一致。
   * @param {string} deliveryId
   * @returns {Promise<Object>}
   */
  async function deleteDelivery(deliveryId) {
    const delivery = (data.deliveries || []).find((item) => item.id === deliveryId)
    if (!delivery) return { ok: false, message: '交付记录不存在' }
    const contract = data.contracts.find((item) => item.id === delivery.contractId)
    if (!contract) return { ok: false, message: '关联合同不存在' }
    const rest = (data.deliveries || []).filter(
      (item) => item.contractId === contract.id && item.id !== deliveryId,
    )
    const counted = rest.filter((item) => item.status !== DELIVERY_STATUS.REJECTED)
    const deliveredAmount = roundMoney(
      counted.reduce((sum, item) => sum + toNumber(item.amount, 0), 0),
      precision.value,
    )
    const latest = counted.map((item) => item.date).filter(Boolean).sort().at(-1) || ''
    const nextContract = {
      ...contract,
      deliveredAmount,
      lastDeliveryDate: latest,
    }
    const result = await applyChanges({
      remove: { deliveries: [deliveryId] },
      put: { contracts: [nextContract] },
    })
    if (!result.ok) return result
    return { ok: true, contract: nextContract }
  }

  /**
   * 字典引用计数。
   * @param {Object} dict
   * @returns {{count:number, label:string}}
   */
  function referenceCountForDict(dict) {
    if (!dict) return { count: 0, label: '记录' }
    switch (dict.category) {
      case 'contractType':
        return { count: data.contracts.filter((c) => c.typeCode === dict.code).length, label: '份合同' }
      case 'contractStatus':
        return { count: data.contracts.filter((c) => c.statusCode === dict.code).length, label: '份合同' }
      case 'payMethod':
        return { count: data.payments.filter((p) => p.methodCode === dict.code).length, label: '条收款记录' }
      case 'department':
        return { count: data.personnel.filter((p) => p.deptCode === dict.code).length, label: '名人员' }
      default:
        return { count: 0, label: '条记录' }
    }
  }

  /**
   * 新增 / 编辑字典项（内置项可改名改色，不可改编码）。
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async function saveDict(input) {
    const existing = input?.id ? data.dicts.find((item) => item.id === input.id) : null
    if (input?.id && !existing) return { ok: false, message: '字典项不存在' }
    if (existing?.builtin && text(input.code) !== existing.code) {
      return { ok: false, message: '内置字典项的编码不可修改，只能改名、改色或停用' }
    }
    const record = {
      id: existing?.id || uuid(),
      category: existing?.category || text(input.category),
      code: text(input.code),
      name: text(input.name),
      sort: toNumber(input.sort, 0),
      enabled: input.enabled !== false,
      color: text(input.color) || '#409EFF',
      builtin: existing?.builtin === true,
      note: text(input.note),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    }
    if (!record.category) return { ok: false, message: '字典分类不能为空' }
    if (!record.code) return { ok: false, message: '编码不能为空' }
    if (!record.name) return { ok: false, message: '名称不能为空' }
    const result = await applyChanges({ put: { dicts: [record] } })
    if (!result.ok) return result
    return { ok: true, dict: record, created: !existing }
  }

  /**
   * 删除字典项：内置项与已被引用的项禁止删除。
   * @param {Object} dict
   * @returns {Promise<Object>}
   */
  async function deleteDict(dict) {
    if (!dict) return { ok: false, message: '字典项不存在' }
    if (dict.builtin) {
      return { ok: false, code: 'BUILTIN', message: '内置状态项不可删除，只能改名、改色或停用' }
    }
    const refs = referenceCountForDict(dict)
    if (refs.count > 0) {
      return {
        ok: false,
        code: 'REFERENCED',
        count: refs.count,
        message: `该项已被 ${refs.count} ${refs.label}引用，只能停用`,
      }
    }
    const result = await applyChanges({ remove: { dicts: [dict.id] } })
    if (!result.ok) return result
    return { ok: true }
  }

  /**
   * 启用 / 停用字典项。
   * @param {Object} dict
   * @param {boolean} enabled
   * @returns {Promise<Object>}
   */
  async function toggleDict(dict, enabled) {
    if (!dict) return { ok: false, message: '字典项不存在' }
    const result = await applyChanges({ put: { dicts: [{ ...dict, enabled }] } })
    if (!result.ok) return result
    return { ok: true }
  }

  /**
   * 保存人员（离职拦截：被合同引用时需先转交）。
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async function savePersonnel(input) {
    const existing = input?.id ? data.personnel.find((item) => item.id === input.id) : null
    if (input?.id && !existing) return { ok: false, message: '人员不存在' }
    if (existing && existing.active !== false && input.active === false) {
      const count = data.contracts.filter((c) => c.ownerId === existing.id).length
      if (count > 0) {
        return {
          ok: false,
          code: 'REFERENCED',
          count,
          message: `该人员仍被 ${count} 份合同引用，请先批量转交负责人后再置为离职`,
        }
      }
    }
    const record = {
      id: existing?.id || uuid(),
      code: text(input.code),
      name: text(input.name),
      deptCode: text(input.deptCode),
      position: text(input.position),
      phone: text(input.phone),
      email: text(input.email),
      active: input.active !== false,
      hireDate: text(input.hireDate),
      note: text(input.note),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    }
    if (!record.code) return { ok: false, message: '人员编号不能为空' }
    if (!record.name) return { ok: false, message: '姓名不能为空' }
    if (!record.deptCode) return { ok: false, message: '请选择部门' }
    const result = await applyChanges({ put: { personnel: [record] } })
    if (!result.ok) return result
    return { ok: true, personnel: record, created: !existing }
  }

  /**
   * 删除人员（被引用时阻止）。
   * @param {string} id
   * @returns {Promise<Object>}
   */
  async function deletePersonnel(id) {
    const existing = data.personnel.find((item) => item.id === id)
    if (!existing) return { ok: false, message: '人员不存在' }
    const count = data.contracts.filter((c) => c.ownerId === id).length
    if (count > 0) {
      return {
        ok: false,
        code: 'REFERENCED',
        count,
        message: `该人员仍被 ${count} 份合同引用，不能删除；可先批量转交或置为离职`,
      }
    }
    const result = await applyChanges({ remove: { personnel: [id] } })
    if (!result.ok) return result
    return { ok: true }
  }

  /**
   * 批量转交合同负责人，并写入操作日志。
   * @param {{fromId:string, toId:string}} input
   * @returns {Promise<Object>}
   */
  async function transferContracts({ fromId, toId }) {
    const from = personnelLookup.value.get(fromId)
    const to = personnelLookup.value.get(toId)
    if (!from || !to) return { ok: false, message: '人员不存在' }
    if (from.id === to.id) return { ok: false, message: '转交对象不能是同一人' }
    if (to.active === false) return { ok: false, message: '转交对象已离职，请选择在职人员' }
    const targets = data.contracts.filter((c) => c.ownerId === from.id)
    if (!targets.length) return { ok: false, message: '该人员名下没有合同' }
    const updated = targets.map((contract) => ({ ...contract, ownerId: to.id, ownerName: to.name }))
    const log = {
      id: uuid(),
      action: 'transferContracts',
      at: nowIso(),
      by: operator(),
      detail: `将 ${updated.length} 份合同从「${from.name}」转交给「${to.name}」`,
    }
    const nextMeta = { ...data.meta, opLogs: [...(data.meta.opLogs || []), log].slice(-200) }
    const result = await applyChanges({ put: { contracts: updated, meta: nextMeta } })
    if (!result.ok) return result
    return { ok: true, count: updated.length, meta: nextMeta }
  }

  /**
   * 保存设置（自动补齐默认值）。
   * @param {Object} patch
   * @returns {Promise<Object>}
   */
  async function saveSettings(patch) {
    const next = normalizeSettings({ ...data.settings, ...patch })
    const result = await applyChanges({ put: { settings: next } })
    if (!result.ok) return result
    return { ok: true, settings: next }
  }

  /**
   * 保存列显隐（记忆到 settings）。
   * @param {Record<string, boolean>} visibility
   * @returns {Promise<Object>}
   */
  function saveColumnVisibility(visibility) {
    return saveSettings({ columnVisibility: { ...data.settings.columnVisibility, ...visibility } })
  }

  /**
   * 新增自定义字典分类。
   * @param {{code:string, name:string}} input
   * @returns {Promise<Object>}
   */
  async function addDictCategory({ code, name }) {
    const c = text(code)
    const n = text(name)
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(c)) return { ok: false, message: '分类编码需为 2-40 位字母/数字/下划线/短横线' }
    if (!n) return { ok: false, message: '分类名称不能为空' }
    const list = data.settings.dictCategories || []
    if (list.some((item) => item.code.toLowerCase() === c.toLowerCase())) {
      return { ok: false, message: '分类编码已存在' }
    }
    if (list.some((item) => item.name === n)) return { ok: false, message: '分类名称已存在' }
    const next = [...list, { code: c, name: n, builtin: false }]
    const result = await saveSettings({ dictCategories: next })
    if (!result.ok) return result
    return { ok: true, category: { code: c, name: n, builtin: false } }
  }

  /**
   * 删除自定义字典分类（内置分类或仍有字典项时阻止）。
   * @param {string} code
   * @returns {Promise<Object>}
   */
  async function removeDictCategory(code) {
    const list = data.settings.dictCategories || []
    const target = list.find((item) => item.code === code)
    if (!target) return { ok: false, message: '分类不存在' }
    if (target.builtin) return { ok: false, message: '内置分类不可删除' }
    const count = data.dicts.filter((item) => item.category === code).length
    if (count > 0) return { ok: false, code: 'REFERENCED', count, message: `该分类下还有 ${count} 个字典项，请先删除或迁移` }
    const result = await saveSettings({ dictCategories: list.filter((item) => item.code !== code) })
    if (!result.ok) return result
    return { ok: true }
  }

  /**
   * 忽略一条提醒（写入 settings，不删除数据）。
   * @param {string} key
   * @returns {Promise<Object>}
   */
  async function ignoreReminder(key) {
    if (!key) return { ok: false, message: '提醒标识为空' }
    const list = (data.settings.ignoredReminders || []).filter(
      (item) => (typeof item === 'string' ? item : item.key) !== key,
    )
    list.push({ key, at: nowIso() })
    return saveSettings({ ignoredReminders: list })
  }

  /**
   * 恢复全部已忽略提醒。
   * @returns {Promise<Object>}
   */
  function restoreIgnoredReminders() {
    return saveSettings({ ignoredReminders: [] })
  }

  /** 载入演示数据（可随时清空）。 */
  async function loadDemoData() {
    const demo = createDemoDataset()
    demo.settings = normalizeSettings({
      ...demo.settings,
      ai: data.settings.ai,
      columnVisibility: data.settings.columnVisibility,
      operatorName: data.settings.operatorName,
    })
    demo.meta = { ...data.meta, seeded: true, storageEngine: status.engine }
    const result = await applyChanges({ replace: demo }, { touch: false })
    if (!result.ok) return result
    return { ok: true, counts: countsOf(demo) }
  }

  /** 清空业务数据（保留设置为默认字典，避免应用不可用）。 */
  async function clearAllData() {
    const defaults = createDemoDataset()
    const next = emptyDataset()
    next.dicts = defaults.dicts.map((dict) => ({ ...dict, id: uuid() }))
    next.settings = normalizeSettings({ ...data.settings, ignoredReminders: [] })
    next.meta = { ...data.meta, seeded: false, lastImportAt: null }
    const result = await applyChanges({ replace: next }, { touch: false })
    if (!result.ok) return result
    return { ok: true, counts: countsOf(next) }
  }

  /** 标记已处理首次启动询问。 */
  async function markSeeded() {
    if (data.meta.seeded) return { ok: true }
    const result = await applyChanges({ put: { meta: { ...data.meta, seeded: true } } })
    return result
  }

  /** 导出备份。 */
  async function exportBackup() {
    return exportBackupFile()
  }

  /** 下载导入前快照。 */
  async function exportSnapshot() {
    return downloadSnapshot()
  }

  /** 解析备份文本。 */
  function parseBackup(textValue) {
    return parseBackupText(textValue)
  }

  /**
   * 导入备份。
   * @param {Object} payload
   * @param {'overwrite'|'merge'} mode
   */
  async function importBackup(payload, mode) {
    return importBackupFile(payload, mode)
  }

  /** 重新检测存储并迁移到 IndexedDB。 */
  async function migrateStorage() {
    return recheckStorage()
  }

  /** 重试写入。 */
  async function retryStorage() {
    return retryWrite()
  }

  /** 刷新容量信息。 */
  async function refreshStorageUsage() {
    return refreshUsage()
  }

  /** 当前可见列。 */
  const visibleColumns = computed(() => data.settings.columnVisibility || {})

  return {
    // 数据
    data,
    settings,
    meta,
    status,
    precision,
    contracts,
    contractsByDirection,
    customerSuggestions,
    personnelLookup,
    activePersonnel,
    personnelOptions,
    dictsByCategory,
    dictOptions,
    dictLookup,
    dictCategories,
    statusDicts,
    statusMap,
    // 统计
    stats,
    statsByDirection,
    reminders,
    remindersByDirection,
    reminderTotal,
    trend,
    trendByDirection,
    typeDistribution,
    typeDistributionByDirection,
    statusDistribution,
    statusDistributionByDirection,
    backupDue,
    storageInfo,
    aiConfig,
    aiReady,
    visibleColumns,
    ignoredKeys,
    // 常量
    columns: CONTRACT_COLUMNS,
    columnsFor,
    quickFilters: QUICK_FILTERS,
    reminderGroups: REMINDER_GROUPS,
    statusCodes: STATUS_CODES,
    contractDirections: CONTRACT_DIRECTIONS,
    directionLabels: DIRECTION_LABELS,
    partyLabels: PARTY_LABELS,
    fundingLabelMap: FUNDING_LABELS,
    deliveryStatus: DELIVERY_STATUS,
    deliveryStatusMeta: DELIVERY_STATUS_META,
    engineLabels: ENGINE_LABELS,
    engines: ENGINE,
    // 方向文案
    directionLabel,
    partyLabel,
    fundingLabels,
    deliveriesFor,
    // 操作
    actions: {
      generateContractNo: () => generateContractNo(data.contracts, data.settings),
      saveContract,
      copyContract,
      deleteContracts,
      bulkUpdate,
      registerPayment,
      deletePayment,
      registerDelivery,
      deleteDelivery,
      saveDict,
      deleteDict,
      toggleDict,
      referenceCountForDict,
      savePersonnel,
      deletePersonnel,
      transferContracts,
      saveSettings,
      saveColumnVisibility,
      addDictCategory,
      removeDictCategory,
      ignoreReminder,
      restoreIgnoredReminders,
      loadDemoData,
      clearAllData,
      markSeeded,
      exportBackup,
      exportSnapshot,
      parseBackup,
      importBackup,
      migrateStorage,
      retryStorage,
      refreshStorageUsage,
      saveAiConfig: (ai) => saveSettings({ ai: { ...data.settings.ai, ...ai } }),
      sanitizeSettingsForBackup,
      matchesQuick: (contract, quick) => matchesQuick(contract, quick, data.settings, data.dicts),
      snapshot,
    },
  }
}

/**
 * 在组件树中提供台账对象（App.vue 调用）。
 * @param {Object} ledger
 */
export function provideLedger(ledger) {
  provide(LEDGER_KEY, ledger)
  return ledger
}

/**
 * 业务组件访问台账的唯一出口。
 * @returns {ReturnType<typeof createLedger>}
 */
export function useLedger() {
  const ledger = inject(LEDGER_KEY)
  if (!ledger) {
    throw new Error('useLedger() 必须在 provideLedger() 之后的组件树中使用')
  }
  return ledger
}
