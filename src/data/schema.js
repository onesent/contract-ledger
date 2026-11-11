import dayjs from 'dayjs'
import { uuid } from '../utils/id'

/** 当前数据结构版本，变更时编写幂等迁移函数。 */
export const SCHEMA_VERSION = 1

/** 应用标识（备份文件与校验共用）。 */
export const APP_ID = 'contract-ledger'

/** 全部数据集合。 */
export const COLLECTIONS = ['contracts', 'payments', 'personnel', 'dicts', 'settings', 'meta']

/** 内置合同状态编码（不可删除，可改名改色）。 */
export const STATUS_CODES = Object.freeze({
  DRAFT: 'draft',
  EXECUTING: 'executing',
  FINISHED: 'finished',
  TERMINATED: 'terminated',
  OVERDUE: 'overdue',
})

/** 新建字典分类的默认模板。 */
export const DICT_CATEGORY_TEMPLATES = [
  {
    code: 'contractType',
    name: '合同类型',
    items: [
      { code: 'sales', name: '销售合同', color: '#409EFF' },
      { code: 'service', name: '服务合同', color: '#67C23A' },
      { code: 'purchase', name: '采购合同', color: '#E6A23C' },
      { code: 'framework', name: '框架协议', color: '#909399' },
    ],
  },
  {
    code: 'contractStatus',
    name: '合同状态',
    items: [
      { code: STATUS_CODES.DRAFT, name: '草稿', color: '#909399', builtin: true },
      { code: STATUS_CODES.EXECUTING, name: '执行中', color: '#409EFF', builtin: true },
      { code: STATUS_CODES.FINISHED, name: '已完结', color: '#67C23A', builtin: true },
      { code: STATUS_CODES.TERMINATED, name: '已终止', color: '#F56C6C', builtin: true },
      { code: STATUS_CODES.OVERDUE, name: '逾期', color: '#E6A23C', builtin: true },
    ],
  },
  {
    code: 'payMethod',
    name: '付款方式',
    items: [
      { code: 'transfer', name: '银行转账', color: '#409EFF' },
      { code: 'cash', name: '现金', color: '#67C23A' },
      { code: 'check', name: '支票', color: '#E6A23C' },
      { code: 'installments', name: '分期付款', color: '#909399' },
    ],
  },
  {
    code: 'department',
    name: '部门',
    items: [
      { code: 'sales', name: '销售部', color: '#409EFF' },
      { code: 'delivery', name: '交付部', color: '#67C23A' },
      { code: 'finance', name: '财务部', color: '#E6A23C' },
      { code: 'admin', name: '行政部', color: '#909399' },
    ],
  },
]

/** 合同表格列定义（列显隐默认值以此为准）。 */
export const CONTRACT_COLUMNS = [
  { prop: 'no', label: '合同编号', width: 150, fixed: true },
  { prop: 'customer', label: '客户名称', minWidth: 180 },
  { prop: 'typeName', label: '合同类型', width: 110 },
  { prop: 'amount', label: '合同金额', width: 140, align: 'right' },
  { prop: 'receivedAmount', label: '已收金额', width: 140, align: 'right' },
  { prop: 'unpaid', label: '未收金额', width: 140, align: 'right' },
  { prop: 'progress', label: '收款进度', width: 170 },
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
 * 默认设置。
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
    dictCategories: DICT_CATEGORY_TEMPLATES.map((c) => ({ code: c.code, name: c.name, builtin: true })),
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
 * 默认 meta。
 * @returns {Object}
 */
export function createMeta() {
  const now = new Date().toISOString()
  return {
    id: 'meta',
    schemaVersion: SCHEMA_VERSION,
    seeded: false,
    lastBackupAt: null,
    lastImportAt: null,
    lastMigrationAt: null,
    storageEngine: '',
    opLogs: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 空数据集。
 * @returns {Object}
 */
export function emptyDataset() {
  return {
    contracts: [],
    payments: [],
    personnel: [],
    dicts: [],
    settings: createSettings(),
    meta: createMeta(),
  }
}

/**
 * 合并设置默认值（幂等）。
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

/**
 * 合并 meta 默认值（幂等）。
 * @param {Object} [value]
 * @returns {Object}
 */
export function normalizeMeta(value) {
  const defaults = createMeta()
  if (!value || typeof value !== 'object') return defaults
  return {
    ...defaults,
    ...value,
    id: 'meta',
    opLogs: Array.isArray(value.opLogs) ? value.opLogs.slice(-200) : [],
  }
}

/**
 * 为记录补齐 id / createdAt / updatedAt（迁移用，幂等）。
 * @param {Object} record
 * @returns {Object}
 */
function ensureRecordMeta(record) {
  const now = new Date().toISOString()
  const next = { ...record }
  if (!next.id) next.id = uuid()
  if (!next.createdAt) next.createdAt = next.updatedAt || now
  if (!next.updatedAt) next.updatedAt = next.createdAt || now
  return next
}

/**
 * 幂等迁移：将任意版本数据集规范到当前 schemaVersion。
 * 只做字段补齐与结构规范化，不删除历史数据。
 * @param {Object} dataset
 * @returns {{dataset:Object, fromVersion:number, toVersion:number, changed:boolean}}
 */
export function migrateDataset(dataset) {
  const source = dataset && typeof dataset === 'object' ? dataset : {}
  const fromVersion = Number(source?.meta?.schemaVersion || 0)
  const next = emptyDataset()
  next.settings = normalizeSettings(source.settings)
  next.meta = normalizeMeta(source.meta)
  for (const name of ['contracts', 'payments', 'personnel', 'dicts']) {
    const list = Array.isArray(source[name]) ? source[name] : []
    next[name] = list
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const record = ensureRecordMeta(item)
        if (name === 'contracts') {
          record.attachments = Array.isArray(record.attachments) ? record.attachments : []
          record.statusLogs = Array.isArray(record.statusLogs) ? record.statusLogs : []
          record.amount = Number.isFinite(Number(record.amount)) ? Number(record.amount) : 0
          record.receivedAmount = Number.isFinite(Number(record.receivedAmount)) ? Number(record.receivedAmount) : 0
        }
        if (name === 'dicts') {
          record.enabled = record.enabled !== false
          record.sort = Number.isFinite(Number(record.sort)) ? Number(record.sort) : 0
          record.builtin = record.builtin === true
        }
        if (name === 'personnel') record.active = record.active !== false
        if (name === 'payments') record.amount = Number(record.amount) || 0
        return record
      })
  }
  next.meta.schemaVersion = SCHEMA_VERSION
  return {
    dataset: next,
    fromVersion,
    toVersion: SCHEMA_VERSION,
    changed: fromVersion !== SCHEMA_VERSION,
  }
}

/** @param {Date|string|number} value */
function iso(value) {
  return dayjs(value).toISOString()
}

/**
 * 生成演示数据（15 条合同，覆盖全部要求的业务场景）。
 * 每次调用基于「当前时间」重新计算相对日期，可作为可清空的种子数据。
 * @returns {Object}
 */
export function createDemoDataset() {
  const dataset = emptyDataset()
  const now = dayjs()
  const today = now.format('YYYY-MM-DD')
  const ago = (n) => now.subtract(n, 'day').format('YYYY-MM-DD')
  const add = (n) => now.add(n, 'day').format('YYYY-MM-DD')
  const at = (n) => iso(now.subtract(n, 'day'))
  const p = (n) => `a0000000-0000-4000-8000-00000000000${n}`
  const dictId = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
  const payId = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

  // ---- 字典 ----
  let dictSeq = 0
  for (const category of DICT_CATEGORY_TEMPLATES) {
    category.items.forEach((item, index) => {
      dictSeq += 1
      dataset.dicts.push({
        id: dictId(dictSeq),
        category: category.code,
        code: item.code,
        name: item.name,
        sort: (index + 1) * 10,
        enabled: true,
        color: item.color,
        builtin: item.builtin === true,
        note: '',
        createdAt: at(200),
        updatedAt: at(200),
      })
    })
  }

  // ---- 人员 ----
  dataset.personnel = [
    {
      id: p(1),
      code: 'YG-001',
      name: '张伟',
      deptCode: 'sales',
      position: '销售经理',
      phone: '13800000001',
      email: 'zhangwei@example.com',
      active: true,
      hireDate: '2021-03-01',
      note: '负责重点客户',
      createdAt: at(400),
      updatedAt: at(30),
    },
    {
      id: p(2),
      code: 'YG-002',
      name: '李娜',
      deptCode: 'sales',
      position: '销售专员',
      phone: '13800000002',
      email: 'lina@example.com',
      active: true,
      hireDate: '2022-07-15',
      note: '',
      createdAt: at(380),
      updatedAt: at(20),
    },
    {
      id: p(3),
      code: 'YG-003',
      name: '王强',
      deptCode: 'delivery',
      position: '项目经理',
      phone: '13800000003',
      email: 'wangqiang@example.com',
      active: true,
      hireDate: '2020-05-20',
      note: '负责交付验收',
      createdAt: at(500),
      updatedAt: at(15),
    },
    {
      id: p(4),
      code: 'YG-004',
      name: '赵敏',
      deptCode: 'finance',
      position: '会计',
      phone: '13800000004',
      email: 'zhaomin@example.com',
      active: true,
      hireDate: '2019-09-02',
      note: '回款核对',
      createdAt: at(600),
      updatedAt: at(10),
    },
    {
      id: p(5),
      code: 'YG-005',
      name: '陈晨',
      deptCode: 'delivery',
      position: '实施工程师',
      phone: '13800000005',
      email: 'chenchen@example.com',
      active: true,
      hireDate: '2023-02-13',
      note: '',
      createdAt: at(300),
      updatedAt: at(8),
    },
    {
      id: p(6),
      code: 'YG-006',
      name: '刘洋',
      deptCode: 'sales',
      position: '销售专员',
      phone: '13800000006',
      email: 'liuyang@example.com',
      active: false,
      hireDate: '2021-11-01',
      note: '已离职，历史合同保留姓名快照，待批量转交',
      createdAt: at(350),
      updatedAt: at(12),
    },
  ]

  const ownerName = (id) => dataset.personnel.find((item) => item.id === id)?.name || ''

  // ---- 合同 ----
  /**
   * @param {Object} input
   * @returns {Object}
   */
  const contract = (input) => {
    const created = input.createdAt || at(30)
    const logs = []
    if (input.logs) {
      for (const log of input.logs) {
        logs.push({
          id: uuid(),
          from: log.from ?? null,
          to: log.to,
          at: log.at,
          by: input.by || '系统初始化',
        })
      }
    }
    return {
      id: input.id,
      no: input.no,
      customer: input.customer,
      typeCode: input.typeCode,
      amount: input.amount,
      receivedAmount: input.receivedAmount,
      paymentDate: input.paymentDate || '',
      signDate: input.signDate,
      startDate: input.startDate || input.signDate,
      dueDate: input.dueDate,
      statusCode: input.statusCode,
      ownerId: input.ownerId,
      ownerName: ownerName(input.ownerId),
      statusChangedAt: input.statusChangedAt || null,
      note: input.note || '',
      attachments: input.attachments || [],
      statusLogs: logs,
      createdAt: created,
      updatedAt: input.updatedAt || created,
    }
  }

  dataset.contracts = [
    contract({
      id: 'c0000000-0000-4000-8000-000000000001',
      no: 'HT-202408-001',
      customer: '星海科技有限公司',
      typeCode: 'sales',
      amount: 480000,
      receivedAmount: 480000,
      paymentDate: '2024-10-20',
      signDate: '2024-08-12',
      startDate: '2024-08-12',
      dueDate: '2025-08-11',
      statusCode: STATUS_CODES.FINISHED,
      ownerId: p(1),
      statusChangedAt: '2025-08-15T02:30:00.000Z',
      note: '跨年度项目，已全额回款并完成验收。',
      createdAt: '2024-08-12T01:00:00.000Z',
      updatedAt: '2025-08-15T02:30:00.000Z',
      logs: [
        { from: null, to: STATUS_CODES.DRAFT, at: '2024-08-12T01:00:00.000Z' },
        { from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: '2024-08-13T03:00:00.000Z' },
        { from: STATUS_CODES.EXECUTING, to: STATUS_CODES.FINISHED, at: '2025-08-15T02:30:00.000Z' },
      ],
      attachments: [
        {
          id: 'f0000000-0000-4000-8000-000000000001',
          name: '星海科技-销售合同-盖章版.pdf',
          size: 486400,
          note: '双方盖章扫描件',
          addedAt: '2024-08-12T02:00:00.000Z',
        },
        {
          id: 'f0000000-0000-4000-8000-000000000002',
          name: '项目验收单.pdf',
          size: 128000,
          note: '客户签字验收',
          addedAt: '2025-08-14T06:00:00.000Z',
        },
      ],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000002',
      no: 'HT-202409-002',
      customer: '云图数据服务有限公司',
      typeCode: 'service',
      amount: 360000,
      receivedAmount: 150000,
      paymentDate: ago(40),
      signDate: ago(90),
      startDate: ago(90),
      dueDate: add(15),
      statusCode: STATUS_CODES.EXECUTING,
      ownerId: p(2),
      statusChangedAt: at(90),
      note: '二期验收后支付尾款 210000 元，需重点跟进。',
      createdAt: at(90),
      updatedAt: at(40),
      logs: [{ from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(90) }],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000003',
      no: 'HT-202410-003',
      customer: '恒远建设集团',
      typeCode: 'purchase',
      amount: 1280000,
      receivedAmount: 640000,
      paymentDate: ago(10),
      signDate: ago(150),
      startDate: ago(150),
      dueDate: now.endOf('month').format('YYYY-MM-DD'),
      statusCode: STATUS_CODES.EXECUTING,
      ownerId: p(3),
      statusChangedAt: at(30),
      note: '本月到期，剩余 640000 元待回款。',
      createdAt: at(150),
      updatedAt: at(10),
      logs: [{ from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(150) }],
      attachments: [
        {
          id: 'f0000000-0000-4000-8000-000000000003',
          name: '恒远建设-采购合同.pdf',
          size: 731000,
          note: '合同正文',
          addedAt: at(150),
        },
      ],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000004',
      no: 'HT-202411-004',
      customer: '北辰医疗科技',
      typeCode: 'sales',
      amount: 96000,
      receivedAmount: 0,
      paymentDate: '',
      signDate: ago(75),
      startDate: ago(75),
      dueDate: ago(20),
      statusCode: STATUS_CODES.EXECUTING,
      ownerId: p(1),
      statusChangedAt: at(75),
      note: '已逾期且至今未收到任何款项，需立即催收。',
      createdAt: at(75),
      updatedAt: at(75),
      logs: [{ from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(75) }],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000005',
      no: 'HT-202412-005',
      customer: '蓝湖环保工程有限公司',
      typeCode: 'service',
      amount: 245000,
      receivedAmount: 96000,
      paymentDate: ago(3),
      signDate: ago(200),
      startDate: ago(190),
      dueDate: add(120),
      statusCode: STATUS_CODES.EXECUTING,
      ownerId: p(3),
      statusChangedAt: at(120),
      note: '状态超过 90 天未变更，用于验证长期未变更提醒。',
      createdAt: at(200),
      updatedAt: at(3),
      logs: [{ from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(120) }],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000006',
      no: 'HT-202412-006',
      customer: '启明电子（跨年示范）',
      typeCode: 'framework',
      amount: 300000,
      receivedAmount: 0,
      paymentDate: '',
      signDate: '2024-12-20',
      startDate: '2026-02-01',
      dueDate: '2025-12-31',
      statusCode: STATUS_CODES.TERMINATED,
      ownerId: p(2),
      statusChangedAt: '2025-03-05T08:00:00.000Z',
      note: '跨年度签订；客户预算取消后终止，未收款。开始日期晚于到期日，用于验证数据质量提醒。',
      createdAt: '2024-12-20T02:00:00.000Z',
      updatedAt: '2025-03-05T08:00:00.000Z',
      logs: [
        { from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: '2025-01-02T02:00:00.000Z' },
        { from: STATUS_CODES.EXECUTING, to: STATUS_CODES.TERMINATED, at: '2025-03-05T08:00:00.000Z' },
      ],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000007',
      no: 'HT-202501-007',
      customer: '明远教育集团',
      typeCode: 'service',
      amount: 0,
      receivedAmount: 0,
      paymentDate: '',
      signDate: ago(30),
      startDate: ago(30),
      dueDate: add(335),
      statusCode: STATUS_CODES.FINISHED,
      ownerId: p(4),
      statusChangedAt: at(10),
      note: '公益赠送服务，合同金额为 0，用于验证收款进度除零展示（应显示「—」）。',
      createdAt: at(30),
      updatedAt: at(10),
      logs: [
        { from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(30) },
        { from: STATUS_CODES.EXECUTING, to: STATUS_CODES.FINISHED, at: at(10) },
      ],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000008',
      no: 'HT-202503-008',
      customer: '天成制造股份有限公司',
      typeCode: 'sales',
      amount: 560000,
      receivedAmount: 560000,
      paymentDate: ago(25),
      signDate: ago(300),
      startDate: ago(300),
      dueDate: ago(30),
      statusCode: STATUS_CODES.FINISHED,
      ownerId: p(3),
      statusChangedAt: at(25),
      note: '全额回款后已完结。',
      createdAt: at(300),
      updatedAt: at(25),
      logs: [
        { from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(300) },
        { from: STATUS_CODES.EXECUTING, to: STATUS_CODES.FINISHED, at: at(25) },
      ],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000009',
      no: 'HT-202505-009',
      customer: '远航物流有限公司',
      typeCode: 'purchase',
      amount: 780000,
      receivedAmount: 300000,
      paymentDate: ago(45),
      signDate: ago(250),
      startDate: ago(250),
      dueDate: add(60),
      statusCode: STATUS_CODES.EXECUTING,
      ownerId: p(1),
      statusChangedAt: at(45),
      note: '分两笔收款，剩余 480000 元。',
      createdAt: at(250),
      updatedAt: at(45),
      logs: [{ from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(250) }],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000010',
      no: 'HT-202506-010',
      customer: '星河互娱文化传媒',
      typeCode: 'service',
      amount: 420000,
      receivedAmount: 420000,
      paymentDate: ago(1),
      signDate: ago(180),
      startDate: ago(180),
      dueDate: add(10),
      statusCode: STATUS_CODES.FINISHED,
      ownerId: p(2),
      statusChangedAt: at(1),
      note: '尾款到账，提前完结。',
      createdAt: at(180),
      updatedAt: at(1),
      logs: [
        { from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(180) },
        { from: STATUS_CODES.EXECUTING, to: STATUS_CODES.FINISHED, at: at(1) },
      ],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000011',
      no: 'HT-202507-011',
      customer: '华宇管理咨询',
      typeCode: 'framework',
      amount: 150000,
      receivedAmount: 50000,
      paymentDate: ago(30),
      signDate: ago(60),
      startDate: ago(60),
      dueDate: ago(5),
      statusCode: STATUS_CODES.EXECUTING,
      ownerId: p(5),
      statusChangedAt: at(60),
      note: '到期已过，仅收到首期款 50000 元。',
      createdAt: at(60),
      updatedAt: at(30),
      logs: [{ from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(60) }],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000012',
      no: 'HT-202508-012',
      customer: '绿源农业发展有限公司',
      typeCode: 'sales',
      amount: 88000,
      receivedAmount: 88000,
      paymentDate: ago(50),
      signDate: ago(120),
      startDate: ago(120),
      dueDate: add(200),
      statusCode: STATUS_CODES.EXECUTING,
      ownerId: p(5),
      statusChangedAt: at(120),
      note: '款项已收齐但状态长期未变更，可用于验证状态维护提醒。',
      createdAt: at(120),
      updatedAt: at(50),
      logs: [{ from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(120) }],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000013',
      no: 'HT-202509-013',
      customer: '新元新材料有限公司',
      typeCode: 'purchase',
      amount: 1250000,
      receivedAmount: 1000000,
      paymentDate: ago(20),
      signDate: ago(40),
      startDate: ago(40),
      dueDate: add(300),
      statusCode: STATUS_CODES.EXECUTING,
      ownerId: p(3),
      statusChangedAt: at(40),
      note: '大额合同，尾款 250000 元待验收。',
      createdAt: at(40),
      updatedAt: at(20),
      logs: [{ from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(40) }],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000014',
      no: 'HT-202510-014',
      customer: '智联软件技术（北京）',
      typeCode: 'service',
      amount: 36000,
      receivedAmount: 0,
      paymentDate: '',
      signDate: ago(10),
      startDate: ago(10),
      dueDate: add(80),
      statusCode: STATUS_CODES.DRAFT,
      ownerId: p(6),
      statusChangedAt: null,
      note: '负责人已离职，合同尚未启动，需批量转交。',
      createdAt: at(10),
      updatedAt: at(10),
      logs: [{ from: null, to: STATUS_CODES.DRAFT, at: at(10) }],
    }),
    contract({
      id: 'c0000000-0000-4000-8000-000000000015',
      no: 'HT-202511-015',
      customer: '康泰生物科技',
      typeCode: 'sales',
      amount: 720000,
      receivedAmount: 200000,
      paymentDate: ago(2),
      signDate: ago(5),
      startDate: ago(5),
      dueDate: add(180),
      statusCode: STATUS_CODES.EXECUTING,
      ownerId: p(4),
      statusChangedAt: at(5),
      note: '本月新签，已收首付款 200000 元。',
      createdAt: at(5),
      updatedAt: at(2),
      logs: [{ from: STATUS_CODES.DRAFT, to: STATUS_CODES.EXECUTING, at: at(5) }],
    }),
  ]

  // ---- 收款流水（金额与合同已收金额严格一致） ----
  const payments = [
    { contractId: 'c0000000-0000-4000-8000-000000000001', amount: 200000, date: '2024-09-10', note: '首付款' },
    { contractId: 'c0000000-0000-4000-8000-000000000001', amount: 280000, date: '2024-10-20', note: '尾款' },
    { contractId: 'c0000000-0000-4000-8000-000000000002', amount: 150000, date: ago(40), note: '首期款' },
    { contractId: 'c0000000-0000-4000-8000-000000000003', amount: 640000, date: ago(10), note: '预付款' },
    { contractId: 'c0000000-0000-4000-8000-000000000005', amount: 96000, date: ago(3), note: '阶段验收款' },
    { contractId: 'c0000000-0000-4000-8000-000000000008', amount: 300000, date: ago(35), note: '首付款' },
    { contractId: 'c0000000-0000-4000-8000-000000000008', amount: 260000, date: ago(25), note: '尾款' },
    { contractId: 'c0000000-0000-4000-8000-000000000009', amount: 180000, date: ago(100), note: '首付款' },
    { contractId: 'c0000000-0000-4000-8000-000000000009', amount: 120000, date: ago(45), note: '二期款' },
    { contractId: 'c0000000-0000-4000-8000-000000000010', amount: 420000, date: ago(1), note: '一次性结清' },
    { contractId: 'c0000000-0000-4000-8000-000000000011', amount: 50000, date: ago(30), note: '首期款' },
    { contractId: 'c0000000-0000-4000-8000-000000000012', amount: 88000, date: ago(50), note: '全额回款' },
    { contractId: 'c0000000-0000-4000-8000-000000000013', amount: 1000000, date: ago(20), note: '预付款' },
    { contractId: 'c0000000-0000-4000-8000-000000000015', amount: 200000, date: ago(2), note: '首付款' },
  ]
  dataset.payments = payments.map((item, index) => ({
    id: payId(index + 1),
    contractId: item.contractId,
    amount: item.amount,
    date: item.date,
    methodCode: 'transfer',
    note: item.note,
    createdAt: iso(`${item.date}T03:00:00.000Z`),
    updatedAt: iso(`${item.date}T03:00:00.000Z`),
  }))

  dataset.meta.seeded = true
  dataset.meta.schemaVersion = SCHEMA_VERSION
  dataset.settings.pageSize = 20
  dataset.settings.ignoredReminders = []
  return dataset
}
