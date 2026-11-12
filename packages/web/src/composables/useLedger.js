import { computed, inject, provide, reactive, ref } from 'vue'
import dayjs from 'dayjs'
import * as api from '../api/client'
import {
  adaptContract,
  adaptDelivery,
  adaptDictCategory,
  adaptDictItem,
  adaptPayment,
  adaptReminder,
  adaptStats,
  adaptStatusLog,
  yuanToCents,
} from '../api/mappers'
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
  normalizeDirection,
  normalizeSettings,
} from '../data/schema'
import { backupFileName, snapshotFileName, toNumber } from '../utils/format'
import {
  QUICK_FILTERS,
  REMINDER_GROUPS,
  dataQualityIssues,
  groupByDict,
  isDueSoon,
  isOverdue,
  isStaleStatus,
  matchesQuick,
  monthlyTrend,
  overdueDaysOf,
  paymentState,
} from '../utils/derive'
import { isConfigured as isAiConfigured } from '../ai/provider'

/** provide / inject 键。 */
export const LEDGER_KEY = Symbol('contract-ledger')

/** 本地服务存储引擎标识（替代旧的 IndexedDB / localStorage / memory 三态）。 */
const ENGINE = Object.freeze({ SQLITE: 'sqlite' })
const ENGINE_LABELS = Object.freeze({ sqlite: '本地服务 (SQLite)' })

/**
 * @param {string} value
 * @returns {string}
 */
function text(value) {
  return value === null || value === undefined ? '' : String(value).trim()
}

/**
 * 触发浏览器下载一个 JSON 文件。
 * @param {string} fileName
 * @param {unknown} payload
 */
function downloadJson(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/**
 * 把 ApiError / 未知异常映射为组件消费的结果对象（保留稳定 code）。
 * @param {unknown} error
 * @returns {{ok:false, code:string, message:string, hint?:string, details?:unknown}}
 */
function toResultError(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return {
      ok: false,
      code: error.code,
      message: error.message || '请求失败',
      hint: error.hint || undefined,
      details: error.details ?? undefined,
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, code: 'INTERNAL', message: `操作失败：${message}` }
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
 *
 * 数据层：所有读写都经本地服务 API（见 api/client.js）；
 * 金额与派生字段一律取服务端视图值，组件不重复计算金额（AGENTS.md 硬约束 3）。
 * @returns {Object}
 */
export function createLedger() {
  /** 全量快照（合同 / 流水 / 交付 / 人员 / 字典 / 设置），供聚合、引用计数、联想与图表使用。 */
  const data = reactive({
    contracts: [],
    payments: [],
    deliveries: [],
    personnel: [],
    dicts: [],
    settings: normalizeSettings(null),
    meta: { lastBackupAt: null, lastImportAt: null, opLogs: [], seeded: true },
  })

  /** 服务端分页的当前页（合同表）与总数。 */
  const pageContracts = ref([])
  const total = ref(0)
  const loading = ref(false)

  /** 合同列表查询参数（服务端）。 */
  const listQuery = ref({
    page: 1,
    pageSize: 20,
    direction: 'sale',
    search: '',
    status: '',
    owner: '',
    sortBy: 'signDate',
    sortOrder: 'desc',
  })

  /** 服务端派生：统计与提醒。 */
  const stats = ref({})
  const reminders = ref([])

  /** 字典分类（来自 /api/dicts 的 categories）。 */
  const dictCategoryRows = ref([])

  /** 当前打开的合同详情（GET /api/contracts/:id：合同 + 流水 + 交付 + 状态日志）。 */
  const contractDetail = ref(null)

  /** 服务健康 / 只读状态。 */
  const status = reactive({
    ready: false,
    engine: ENGINE.SQLITE,
    writable: true,
    portable: false,
    idbAvailable: false,
    idbError: '',
    writeError: null,
    lastError: '',
    usage: { bytes: null, quota: null, usage: null, source: 'server' },
    server: { version: '', schemaVersion: '' },
  })

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
      list.sort(
        (a, b) =>
          toNumber(a.sort, 0) - toNumber(b.sort, 0) ||
          String(a.name).localeCompare(String(b.name), 'zh'),
      )
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

  const dictCategories = computed(() => dictCategoryRows.value)
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
        deptName: person.deptName || dept?.name || person.deptCode || '',
        position: person.position || '',
      }
    }),
  )

  // ---------- 合同派生视图（金额字段取服务端，补充展示元信息） ----------
  /** 每份合同的最近收 / 付款日期（服务端视图不含该字段，由流水事实派生展示值）。 */
  const lastPaymentDateByContract = computed(() => {
    /** @type {Map<string, string>} */
    const map = new Map()
    for (const payment of data.payments) {
      const current = map.get(payment.contractId)
      if (!current || String(payment.date || '') > current) map.set(payment.contractId, String(payment.date || ''))
    }
    return map
  })

  const enrich = (contract) => {
    const type = dictLookup.value.get(`contractType:${contract.typeCode}`)
    const state = statusMap.value.get(contract.statusCode)
    const owner = personnelLookup.value.get(contract.ownerId)
    return {
      ...contract,
      direction: normalizeDirection(contract.direction),
      typeName: contract.typeName || type?.name || contract.typeCode || '—',
      typeColor: type?.color || '#909399',
      statusName: contract.statusName || state?.name || contract.statusCode || '—',
      statusColor: state?.color || '#909399',
      ownerName: contract.ownerName || owner?.name || '—',
      ownerActive: owner ? owner.active !== false : false,
      // 资金 / 交付 / 进度 / 错位：全部来自服务端视图（mappers 已换算为元）
      paymentDate: contract.paymentDate || lastPaymentDateByContract.value.get(contract.id) || '',
      paymentState: paymentState(contract),
      deliveryState: paymentState({ ...contract, receivedAmount: contract.deliveredAmount }),
      overdue: isOverdue(contract, data.dicts),
      dueSoon: isDueSoon(contract, data.settings.reminderDays, data.dicts),
      stale: isStaleStatus(contract, data.settings.staleDays),
      overdueDays: overdueDaysOf(contract, data.dicts),
      issues: dataQualityIssues(contract),
    }
  }

  /** 全量快照合同（聚合 / 计数 / 图表用）。 */
  const contracts = computed(() => data.contracts.map(enrich))

  /** 服务端分页的当前页（合同表用）。 */
  const pagedContracts = computed(() => pageContracts.value.map(enrich))

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

  // ---------- 统计 / 提醒（服务端派生） ----------
  const statsByDirection = computed(() => ({
    [CONTRACT_DIRECTIONS.SALE]: stats.value[CONTRACT_DIRECTIONS.SALE] || emptyStats(CONTRACT_DIRECTIONS.SALE),
    [CONTRACT_DIRECTIONS.PURCHASE]:
      stats.value[CONTRACT_DIRECTIONS.PURCHASE] || emptyStats(CONTRACT_DIRECTIONS.PURCHASE),
  }))

  const remindersByDirection = computed(() => {
    /** @type {Record<string, Array<Object>>} */
    const grouped = { [CONTRACT_DIRECTIONS.SALE]: [], [CONTRACT_DIRECTIONS.PURCHASE]: [] }
    for (const group of reminders.value) grouped[group.direction]?.push(group)
    return grouped
  })

  const reminderTotal = computed(() =>
    reminders.value.reduce((sum, group) => sum + group.count, 0),
  )

  const ignoredKeys = computed(() =>
    (data.settings.ignoredReminders || [])
      .map((item) => (typeof item === 'string' ? item : item.key))
      .filter(Boolean),
  )

  // ---------- 图表聚合（近 12 月趋势 / 类型 / 状态分布；仅展示聚合，不计算金额真相） ----------
  const trendFor = (direction) =>
    monthlyTrend({ contracts: data.contracts, payments: data.payments, months: 12, direction })

  const trend = computed(() =>
    monthlyTrend({ contracts: data.contracts, payments: data.payments, months: 12 }),
  )
  const trendByDirection = computed(() => ({
    [CONTRACT_DIRECTIONS.SALE]: trendFor(CONTRACT_DIRECTIONS.SALE),
    [CONTRACT_DIRECTIONS.PURCHASE]: trendFor(CONTRACT_DIRECTIONS.PURCHASE),
  }))
  const typeDistribution = computed(() => groupByDict(data.contracts, 'typeCode', data.dicts))
  const statusDistribution = computed(() => groupByDict(data.contracts, 'statusCode', data.dicts))
  const typeDistributionByDirection = computed(() => ({
    [CONTRACT_DIRECTIONS.SALE]: groupByDict(data.contracts, 'typeCode', data.dicts, CONTRACT_DIRECTIONS.SALE),
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

  /** 空统计兜底（首屏未加载时避免 NaN）。 */
  function emptyStats(direction) {
    return {
      direction,
      contractCount: 0,
      totalAmount: 0,
      receivedAmount: 0,
      deliveredAmount: 0,
      unpaidAmount: 0,
      paymentRate: null,
      deliveryRate: null,
      executingCount: 0,
      monthSignedCount: 0,
      monthSignedAmount: 0,
      dueSoonCount: 0,
      overdueCount: 0,
      overdueUnpaidAmount: 0,
      paymentCount: 0,
      statusCounts: {},
    }
  }

  const backupDue = computed(() => false)

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
    server: status.server,
  }))

  const aiConfig = computed(() => data.settings.ai || {})
  const aiReady = computed(() => isAiConfigured(data.settings.ai))

  /**
   * 列显隐为视图状态：服务端暂无 settings 写命令，故仅在本次会话内生效（不持久化）。
   * 初值来自只读 settings.columnVisibility。
   */
  const columnVisibility = ref({})
  const visibleColumns = computed(() => columnVisibility.value)

  // ---------- 数据加载 ----------

  /** 读取服务端分页的合同当前页。 */
  async function loadContractsPage() {
    const query = listQuery.value
    const result = await api.listContracts({
      page: query.page,
      pageSize: query.pageSize,
      direction: query.direction,
      search: query.search || undefined,
      status: query.status || undefined,
      owner: query.owner || undefined,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    })
    pageContracts.value = (result.items || []).map(adaptContract)
    total.value = result.total || 0
  }

  /** 刷新统计（服务端）。 */
  async function refreshStats() {
    const result = await api.getStats()
    const mapped = {}
    for (const direction of [CONTRACT_DIRECTIONS.SALE, CONTRACT_DIRECTIONS.PURCHASE]) {
      const summary = result.stats?.[direction]
      if (summary) mapped[direction] = adaptStats(summary, direction)
    }
    stats.value = mapped
  }

  /** 刷新提醒（服务端，两方向合并）。 */
  async function refreshReminders() {
    const [sale, purchase] = await Promise.all([api.getReminders('sale'), api.getReminders('purchase')])
    const ignored = new Set(ignoredKeys.value)
    const tagged = (groups, direction) =>
      (groups.reminders || []).map((group) => {
        const adapted = adaptReminder(group)
        const items = adapted.items.filter((item) => !ignored.has(item.ignoreKey))
        return { ...adapted, direction, items, count: Math.max(0, adapted.count - (adapted.items.length - items.length)) }
      })
    reminders.value = [...tagged(sale, 'sale'), ...tagged(purchase, 'purchase')]
  }

  /** 刷新字典（分类 + 项）。 */
  async function refreshDicts() {
    const result = await api.listDicts()
    dictCategoryRows.value = (result.categories || []).map(adaptDictCategory)
    data.dicts = (result.items || []).map(adaptDictItem)
  }

  /** 刷新人员（含离职）。 */
  async function refreshPersonnel() {
    const result = await api.listPersonnel(true)
    data.personnel = result.items || []
  }

  /**
   * 全量刷新：导出快照（合同 / 流水 / 交付 / 人员 / 设置）+ 字典 + 分页 + 统计 + 提醒。
   * 启动与每次写操作后调用，保证聚合视图与服务端一致。
   */
  async function refresh() {
    loading.value = true
    try {
      const dataset = await api.exportDataset()
      const payload = dataset.data || {}
      data.contracts = (payload.contracts || []).map(adaptContract)
      data.payments = (payload.payments || []).map(adaptPayment)
      data.deliveries = (payload.deliveries || []).map(adaptDelivery)
      data.personnel = payload.personnel || []
      data.settings = normalizeSettings(payload.settings?.app || null)
      if (Object.keys(columnVisibility.value).length === 0) {
        columnVisibility.value = { ...data.settings.columnVisibility }
      }
      await Promise.all([refreshDicts(), loadContractsPage(), refreshStats(), refreshReminders()])
      status.ready = true
    } catch (error) {
      status.lastError = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      loading.value = false
    }
  }

  /** 写操作后刷新：分页当前页 + 统计 + 提醒 + 快照（人员 / 字典受影响时一并刷新）。 */
  async function afterWrite(scope) {
    try {
      if (scope === 'personnel') await refreshPersonnel()
      else if (scope === 'dicts') await refreshDicts()
      await Promise.all([loadContractsPage(), refreshStats(), refreshReminders()])
      // 合同 / 流水 / 交付变化会影响快照聚合
      if (scope !== 'personnel' && scope !== 'dicts') {
        const dataset = await api.exportDataset()
        const payload = dataset.data || {}
        data.contracts = (payload.contracts || []).map(adaptContract)
        data.payments = (payload.payments || []).map(adaptPayment)
        data.deliveries = (payload.deliveries || []).map(adaptDelivery)
      }
      // 详情抽屉打开时同步刷新（状态日志 / 流水 / 交付）
      const openId = contractDetail.value?.contract?.id
      if (openId) await loadContractDetail(openId)
    } catch (error) {
      status.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  /** 启动：健康检查 + 全量刷新。 */
  async function init() {
    try {
      const health = await api.getHealth()
      status.server = { version: health.version || '', schemaVersion: health.schemaVersion || '' }
      await refresh()
      return { ok: true }
    } catch (error) {
      status.lastError = error instanceof Error ? error.message : String(error)
      return { ok: false, message: status.lastError }
    }
  }

  // ---------- 领域操作（全部经命令端点） ----------

  /**
   * 保存合同（新增 / 编辑）。金额元 → 分；已收 / 已交付由流水与交付维护，不随表单提交。
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async function saveContract(input) {
    const direction = text(input.direction) || CONTRACT_DIRECTIONS.SALE
    const body = {
      no: text(input.no),
      projectName: text(input.projectName),
      direction,
      counterparty: text(input.customer),
      typeCode: text(input.typeCode),
      statusCode: text(input.statusCode),
      ownerId: input.ownerId ? String(input.ownerId) : null,
      amountCents: yuanToCents(input.amount),
      signDate: text(input.signDate),
      startDate: text(input.startDate) || text(input.signDate),
      dueDate: text(input.dueDate),
      note: text(input.note),
    }
    if (input.id) body.id = String(input.id)
    try {
      const result = await api.saveContract(body)
      await afterWrite()
      return { ok: true, contract: result.contract, created: !input.id }
    } catch (error) {
      return toResultError(error)
    }
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
   * 批量删除合同（服务端同事务级联删除关联流水与交付）。
   * @param {string[]} ids
   * @returns {Promise<Object>}
   */
  async function deleteContracts(ids) {
    const list = (ids || []).filter(Boolean)
    if (!list.length) return { ok: false, message: '未选择合同' }
    const paymentCount = data.payments.filter((p) => list.includes(p.contractId)).length
    const deliveryCount = data.deliveries.filter((d) => list.includes(d.contractId)).length
    try {
      for (const id of list) await api.deleteContract(id)
      await afterWrite()
      return { ok: true, contracts: list.length, payments: paymentCount, deliveries: deliveryCount }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 批量修改状态 / 负责人（逐条 contract.upsert）。
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

    let statusChanges = 0
    let ownerChanges = 0
    try {
      for (const contract of data.contracts) {
        if (!set.has(contract.id)) continue
        const body = {
          id: contract.id,
          no: contract.no,
          projectName: contract.projectName || '',
          direction: contract.direction,
          counterparty: contract.customer || contract.counterparty,
          typeCode: contract.typeCode,
          statusCode: patch.statusCode || contract.statusCode,
          ownerId: patch.ownerId ? patch.ownerId : contract.ownerId || null,
          amountCents: contract.amountCents,
          signDate: contract.signDate,
          startDate: contract.startDate || contract.signDate,
          dueDate: contract.dueDate,
          note: contract.note || '',
        }
        if (patch.statusCode && patch.statusCode !== contract.statusCode) statusChanges += 1
        if (patch.ownerId && patch.ownerId !== contract.ownerId) ownerChanges += 1
        await api.saveContract(body)
      }
      await afterWrite()
      return { ok: true, count: set.size, statusChanges, ownerChanges }
    } catch (error) {
      await afterWrite()
      return toResultError(error)
    }
  }

  /**
   * 登记收款 / 付款。
   * @param {{contractId:string, amount:number, date:string, note?:string, methodCode?:string}} input
   * @returns {Promise<Object>}
   */
  async function registerPayment(input) {
    try {
      const result = await api.recordPayment({
        contractId: input.contractId,
        date: input.date,
        amountCents: yuanToCents(input.amount),
        methodCode: text(input.methodCode) || undefined,
        note: text(input.note) || undefined,
      })
      await afterWrite()
      return { ok: true, payment: result.payment, contract: result.contract }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 删除一笔资金流水。
   * @param {string} paymentId
   * @returns {Promise<Object>}
   */
  async function deletePayment(paymentId) {
    try {
      const result = await api.deletePayment(paymentId)
      await afterWrite()
      return { ok: true, contract: result.contract }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 登记交付执行明细。
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async function registerDelivery(input) {
    try {
      const result = await api.recordDelivery({
        contractId: input.contractId,
        date: input.date,
        amountCents: yuanToCents(input.amount),
        quantity: input.quantity === null || input.quantity === undefined || input.quantity === '' ? null : Number(input.quantity),
        unit: text(input.unit) || undefined,
        status: text(input.status) || DELIVERY_STATUS.DELIVERED,
        note: text(input.note) || undefined,
      })
      await afterWrite()
      return { ok: true, delivery: result.delivery, contract: result.contract }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 删除一条交付明细。
   * @param {string} deliveryId
   * @returns {Promise<Object>}
   */
  async function deleteDelivery(deliveryId) {
    try {
      const result = await api.deleteDelivery(deliveryId)
      await afterWrite()
      return { ok: true, contract: result.contract }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 字典引用计数（基于全量快照）。
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
   * 新增 / 编辑字典项。
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async function saveDict(input) {
    const existing = input?.id ? data.dicts.find((item) => item.id === input.id) : null
    if (input?.id && !existing) return { ok: false, message: '字典项不存在' }
    if (existing?.builtin && text(input.code) !== existing.code) {
      return { ok: false, message: '内置字典项的编码不可修改，只能改名、改色或停用' }
    }
    try {
      await api.saveDict({
        kind: 'item',
        id: input.id || undefined,
        categoryCode: text(input.category),
        code: text(input.code),
        name: text(input.name),
        color: text(input.color) || undefined,
        enabled: input.enabled !== false,
        sort: toNumber(input.sort, 0),
      })
      await afterWrite('dicts')
      return { ok: true, created: !existing }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 删除字典项。
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
    try {
      await api.deleteDict({ kind: 'item', id: dict.id })
      await afterWrite('dicts')
      return { ok: true }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 启用 / 停用字典项。
   * @param {Object} dict
   * @param {boolean} enabled
   * @returns {Promise<Object>}
   */
  async function toggleDict(dict, enabled) {
    if (!dict) return { ok: false, message: '字典项不存在' }
    try {
      await api.saveDict({
        kind: 'item',
        id: dict.id,
        categoryCode: dict.category,
        code: dict.code,
        name: dict.name,
        color: dict.color || undefined,
        enabled,
        sort: toNumber(dict.sort, 0),
      })
      await afterWrite('dicts')
      return { ok: true }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 保存人员。
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
    try {
      const result = await api.savePersonnel({
        id: input.id || undefined,
        code: text(input.code),
        name: text(input.name),
        deptCode: text(input.deptCode) || undefined,
        position: text(input.position) || undefined,
        phone: text(input.phone) || undefined,
        email: text(input.email) || undefined,
        active: input.active !== false,
        hireDate: text(input.hireDate) || undefined,
        note: text(input.note) || undefined,
      })
      await afterWrite('personnel')
      return { ok: true, personnel: result.personnel, created: !existing }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 删除人员。
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
    try {
      await api.deletePersonnel(id)
      await afterWrite('personnel')
      return { ok: true }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 批量转交合同负责人。
   * @param {{fromId:string, toId:string}} input
   * @returns {Promise<Object>}
   */
  async function transferContracts({ fromId, toId }) {
    const from = personnelLookup.value.get(fromId)
    const to = personnelLookup.value.get(toId)
    if (!from || !to) return { ok: false, message: '人员不存在' }
    if (from.id === to.id) return { ok: false, message: '转交对象不能是同一人' }
    if (to.active === false) return { ok: false, message: '转交对象已离职，请选择在职人员' }
    try {
      const result = await api.transferPersonnel({ fromId, toId })
      await afterWrite('personnel')
      return { ok: true, count: result.moved }
    } catch (error) {
      return toResultError(error)
    }
  }

  // ---------- 设置（服务端暂无写命令：只读，保存禁用） ----------

  /**
   * 保存设置：服务端尚无 settings 写命令，统一返回禁用提示（不静默丢弃 UI）。
   * @returns {Promise<Object>}
   */
  async function saveSettings() {
    return {
      ok: false,
      code: 'READONLY',
      message: '设置写入将在后续版本开放',
      hint: '当前服务端未提供设置写命令，业务设置仅可经导入备份调整。',
    }
  }

  /**
   * 保存列显隐：更新会话内的视图状态（不持久化，服务端暂无 settings 写命令）。
   * @param {Record<string, boolean>} visibility
   * @returns {Promise<Object>}
   */
  async function saveColumnVisibility(visibility) {
    columnVisibility.value = { ...columnVisibility.value, ...visibility }
    return { ok: true }
  }

  /** 保存 AI 配置（无服务端命令）。 */
  function saveAiConfig() {
    return saveSettings()
  }

  /**
   * 新增自定义字典分类（经 dict.upsert kind=category）。
   * @param {{code:string, name:string}} input
   * @returns {Promise<Object>}
   */
  async function addDictCategory({ code, name }) {
    const c = text(code)
    const n = text(name)
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(c)) return { ok: false, message: '分类编码需为 2-40 位字母/数字/下划线/短横线' }
    if (!n) return { ok: false, message: '分类名称不能为空' }
    if (dictCategories.value.some((item) => item.code.toLowerCase() === c.toLowerCase())) {
      return { ok: false, message: '分类编码已存在' }
    }
    if (dictCategories.value.some((item) => item.name === n)) return { ok: false, message: '分类名称已存在' }
    try {
      await api.saveDict({ kind: 'category', categoryCode: c, name: n })
      await afterWrite('dicts')
      return { ok: true, category: { code: c, name: n, builtin: false } }
    } catch (error) {
      return toResultError(error)
    }
  }

  /**
   * 删除自定义字典分类（经 dict.delete kind=category）。
   * @param {string} code
   * @returns {Promise<Object>}
   */
  async function removeDictCategory(code) {
    const target = dictCategories.value.find((item) => item.code === code)
    if (!target) return { ok: false, message: '分类不存在' }
    if (target.builtin) return { ok: false, message: '内置分类不可删除' }
    const count = data.dicts.filter((item) => item.category === code).length
    if (count > 0) return { ok: false, code: 'REFERENCED', count, message: `该分类下还有 ${count} 个字典项，请先删除或迁移` }
    try {
      await api.deleteDict({ kind: 'category', id: target.id })
      await afterWrite('dicts')
      return { ok: true }
    } catch (error) {
      return toResultError(error)
    }
  }

  /** 忽略一条提醒（写设置，无服务端命令）。 */
  async function ignoreReminder() {
    return saveSettings()
  }

  /** 恢复全部已忽略提醒（写设置，无服务端命令）。 */
  function restoreIgnoredReminders() {
    return saveSettings()
  }

  // ---------- 备份 / 恢复 ----------

  /** 导出备份：GET /api/export 并下载 JSON。 */
  async function exportBackup() {
    try {
      const dataset = await api.exportDataset()
      const fileName = backupFileName()
      downloadJson(fileName, dataset)
      data.meta.lastBackupAt = new Date().toISOString()
      return { ok: true, fileName }
    } catch (error) {
      return toResultError(error)
    }
  }

  /** 下载导入前快照（同导出，文件名不同）。 */
  async function exportSnapshot() {
    const dataset = await api.exportDataset()
    const fileName = snapshotFileName()
    downloadJson(fileName, dataset)
    return { ok: true, fileName }
  }

  /** 解析备份文本（结构校验交服务端；此处只做 JSON 解析与基本形状检查）。 */
  function parseBackup(textValue) {
    let payload
    try {
      payload = JSON.parse(textValue)
    } catch {
      return { ok: false, errors: ['文件内容不是合法的 JSON 对象'], message: '备份文件解析失败' }
    }
    if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
      return { ok: false, errors: ['缺少 data 对象'], message: '备份结构不合法' }
    }
    const counts = {
      contracts: (payload.data.contracts || []).length,
      payments: (payload.data.payments || []).length,
      deliveries: (payload.data.deliveries || []).length,
      personnel: (payload.data.personnel || []).length,
      dicts: (payload.data.dicts || []).length,
    }
    return { ok: true, payload, counts, warnings: [] }
  }

  /**
   * 导入备份：POST /api/import。
   * @param {Object} payload 备份对象
   * @param {'overwrite'|'merge'} mode
   */
  async function importBackup(payload, mode) {
    try {
      const result = await api.importDataset({
        mode: mode === 'merge' ? 'merge' : 'replace',
        dataset: payload,
      })
      data.meta.lastImportAt = new Date().toISOString()
      await refresh()
      const report = result.report || {}
      return {
        ok: true,
        message: `导入完成：合同 ${report.contracts ?? 0} 份、收款 ${report.payments ?? 0} 条、人员 ${report.personnel ?? 0} 名、字典 ${report.dicts ?? 0} 项`,
      }
    } catch (error) {
      return toResultError(error)
    }
  }

  // ---------- 表格列 / 方向文案 ----------

  /**
   * 某合同的交付执行明细（按交付日期倒序，供详情抽屉直接渲染）。
   * @param {string} contractId
   * @returns {Array<Object>}
   */
  function deliveriesFor(contractId) {
    return data.deliveries
      .filter((item) => item.contractId === contractId)
      .slice()
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      })
  }

  /**
   * 读取合同详情（含状态日志），写入 contractDetail 供详情抽屉渲染。
   * @param {string} contractId
   * @returns {Promise<Object>}
   */
  async function loadContractDetail(contractId) {
    if (!contractId) {
      contractDetail.value = null
      return { ok: false, message: '未选择合同' }
    }
    try {
      const result = await api.getContract(contractId)
      contractDetail.value = {
        contract: adaptContract(result.contract),
        payments: (result.payments || []).map(adaptPayment),
        deliveries: (result.deliveries || []).map(adaptDelivery),
        statusLogs: (result.statusLogs || []).map(adaptStatusLog),
      }
      return { ok: true, detail: contractDetail.value }
    } catch (error) {
      return toResultError(error)
    }
  }

  function directionLabel(direction) {
    return DIRECTION_LABELS[normalizeDirection(direction)]
  }
  function partyLabel(direction) {
    return PARTY_LABELS[normalizeDirection(direction)]
  }
  function fundingLabels(direction) {
    return { ...FUNDING_LABELS[normalizeDirection(direction)] }
  }
  function columnsFor(direction) {
    return contractColumns(normalizeDirection(direction))
  }

  /**
   * 设置服务端列表查询参数并刷新当前页。
   * @param {Object} patch
   */
  async function setListQuery(patch) {
    listQuery.value = { ...listQuery.value, ...patch }
    await loadContractsPage()
  }

  return {
    // 数据
    data,
    settings,
    meta,
    status,
    loading,
    precision,
    contracts,
    pageContracts: pagedContracts,
    total,
    listQuery,
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
    contractDetail,
    // 操作
    actions: {
      init,
      refresh,
      setListQuery,
      loadContractsPage,
      loadContractDetail,
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
      saveAiConfig,
      addDictCategory,
      removeDictCategory,
      ignoreReminder,
      restoreIgnoredReminders,
      exportBackup,
      exportSnapshot,
      parseBackup,
      importBackup,
      matchesQuick: (contract, quick) => matchesQuick(contract, quick, data.settings, data.dicts),
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

/**
 * 集合记录数（页脚 / 存储状态展示用）。
 * @param {Object} snapshot
 * @returns {{contracts:number, payments:number, deliveries:number, personnel:number, dicts:number}}
 */
function countsOf(snapshot) {
  return {
    contracts: snapshot.contracts.length,
    payments: snapshot.payments.length,
    deliveries: snapshot.deliveries.length,
    personnel: snapshot.personnel.length,
    dicts: snapshot.dicts.length,
  }
}
