import { randomUUID } from 'node:crypto'
import type {
  ContractRow,
  ContractStatusLogRow,
  DictCategoryRow,
  DictItemRow,
  DeliveryRow,
  DeliveryStatus,
  PaymentRow,
  PersonnelRow,
} from '@ledger/core'
import type { Database } from './db.js'
import { createRepoRuntime } from './kysely.js'
import { SqliteContractRepository } from './repo/contracts.js'
import { SqliteDeliveryRepository } from './repo/deliveries.js'
import { SqliteDictRepository } from './repo/dicts.js'
import type { DeliveryRecord, PaymentRecord } from './repo/mappers.js'
import { toDeliveryRow, toPaymentRow } from './repo/mappers.js'
import { SqlitePaymentRepository } from './repo/payments.js'
import { SqlitePersonnelRepository } from './repo/personnel.js'
import { SqliteContractStatusLogRepository } from './repo/status-logs.js'
import { executeAll, type RepoRuntime } from './repo/runtime.js'
import {
  DATASET_APP,
  DATASET_SCHEMA_VERSION,
  type DatasetDictRow,
  type DatasetExport,
  type DatasetSchemaVersion,
  type ImportOptions,
  type ImportReport,
  type LegacyDatasetData,
} from './dataset-types.js'
import {
  isPlainObject,
  isoTimestamp,
  legacyYuanToCents,
  nowIso,
  readArray,
  readBoolean,
  readCents,
  readDictCategoryMetadata,
  readFiniteNumber,
  readString,
  readStringOrEmpty,
  sanitizeSettingsForExport,
  type DictCategoryMeta,
} from './dataset-support.js'

export * from './dataset-types.js'

/** settings 表读取行。 */
interface SettingRecord {
  key: string
  value_json: string
}

/** 字典导入上下文：按 code 去重并支持按需创建。 */
interface DictContext {
  readonly categories: Map<string, DictCategoryRow>
  readonly items: Map<string, DictItemRow>
  readonly metadata: Map<string, DictCategoryMeta>
  readonly nowText: string
}

/** 合同导入计划：行 + 状态日志（日志在合同插入后写入）。 */
interface ContractPlan {
  readonly row: ContractRow
  readonly logs: ContractStatusLogRow[]
}

/** 导入时已规范化的资金流水 / 交付明细。 */
interface NormalizedPayment {
  readonly row: PaymentRow
}

/** 导入时已规范化的交付明细。 */
interface NormalizedDelivery {
  readonly row: DeliveryRow
}

/** 解析方向：合法值直取，缺失时按旧规则由合同类型推断。 */
function readDirection(value: unknown, typeCode: string): 'sale' | 'purchase' {
  const text = readString(value)
  if (text === 'sale' || text === 'purchase') return text
  return typeCode === 'purchase' ? 'purchase' : 'sale'
}

/** 解析交付状态：非法值回落为 delivered。 */
function readDeliveryStatus(value: unknown): DeliveryStatus {
  const text = readString(value)
  if (text === 'delivered' || text === 'accepted' || text === 'rejected') return text
  return 'delivered'
}

/** 字典键：分类 code + 项 code。 */
function dictKey(categoryCode: string, code: string): string {
  return `${categoryCode}\u0000${code}`
}

/** 视图行 → 旧版扁平字典导出行。 */
function toDatasetDictRow(row: DictItemRow): DatasetDictRow {
  return {
    id: row.id,
    category: row.categoryCode,
    code: row.code,
    name: row.name,
    sort: row.sort,
    enabled: row.enabled,
    color: row.color,
    builtin: row.builtin,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * 读取 settings 键值表并递归剔除敏感字段。
 * @param db 数据库连接
 */
function readSettingsMap(db: Database): Record<string, unknown> {
  const rows = db
    .prepare<[], SettingRecord>('SELECT key, value_json FROM settings ORDER BY key')
    .all()
  const map: Record<string, unknown> = {}
  for (const row of rows) {
    let parsed: unknown = row.value_json
    try {
      parsed = JSON.parse(row.value_json)
    } catch {
      /* 损坏的 settings 值按原始字符串导出，避免阻断整个导出 */
    }
    map[row.key] = parsed
  }
  return sanitizeSettingsForExport(map)
}

/**
 * 导出数据集：合同为视图行（camelCase、整数分、含派生字段），
 * settings 为键值映射且已剔除密钥；输出可直接 `JSON.stringify`。
 * @param db 数据库连接
 */
export function exportDataset(db: Database): DatasetExport {
  const runtime = createRepoRuntime(db)
  const contractsRepo = new SqliteContractRepository(runtime)
  const personnelRepo = new SqlitePersonnelRepository(runtime)
  const dictRepo = new SqliteDictRepository(runtime)

  const payments = executeAll<PaymentRecord>(
    runtime,
    runtime.kysely.selectFrom('payments').selectAll().orderBy('date', 'asc').orderBy('id', 'asc'),
  ).map(toPaymentRow)
  const deliveries = executeAll<DeliveryRecord>(
    runtime,
    runtime.kysely.selectFrom('deliveries').selectAll().orderBy('date', 'asc').orderBy('id', 'asc'),
  ).map(toDeliveryRow)

  return {
    app: DATASET_APP,
    schemaVersion: DATASET_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      contracts: contractsRepo.list(),
      payments,
      deliveries,
      personnel: personnelRepo.list(true),
      dicts: dictRepo.listItems().map(toDatasetDictRow),
      settings: readSettingsMap(db),
    },
  }
}

/**
 * 校验备份根结构；失败时抛出包含前若干条问题列表的中文错误。
 * @param payload 任意输入
 */
function validatePayload(payload: unknown): { schemaVersion: DatasetSchemaVersion; data: LegacyDatasetData } {
  if (!isPlainObject(payload)) {
    throw new Error('导入失败：备份内容不是合法的 JSON 对象。')
  }
  const problems: string[] = []
  if (payload.app !== DATASET_APP) {
    problems.push(`应用标识不匹配：期望 "${DATASET_APP}"，实际 "${String(payload.app)}"`)
  }
  const version = payload.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 3) {
    problems.push('schemaVersion 必须为 1、2 或 3 的整数')
  }
  let data: Record<string, unknown> | null = null
  if (!isPlainObject(payload.data)) {
    problems.push('缺少 data 对象')
  } else {
    data = payload.data
    for (const name of ['contracts', 'payments', 'personnel', 'dicts']) {
      if (!Array.isArray(data[name])) problems.push(`data.${name} 应为数组`)
    }
    if (data.deliveries !== undefined && !Array.isArray(data.deliveries)) {
      problems.push('data.deliveries 应为数组')
    }
  }
  if (problems.length > 0 || data === null) {
    const lines = problems.slice(0, 10).join('\n- ')
    throw new Error(`导入失败（${problems.length} 项问题）：\n- ${lines}`)
  }
  const schemaVersion: DatasetSchemaVersion = version === 1 ? 1 : version === 2 ? 2 : 3
  const datasetData: LegacyDatasetData = {
    contracts: data.contracts,
    payments: data.payments,
    deliveries: data.deliveries,
    personnel: data.personnel,
    dicts: data.dicts,
    settings: data.settings,
  }
  return { schemaVersion, data: datasetData }
}

/** 业务日期（YYYY-MM-DD）且为真实日历日期。 */
function isBusinessDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** ISO-8601 时间戳（必须带时区偏移或 Z）。 */
function isIsoTimestampText(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false
  }
  return !Number.isNaN(Date.parse(value))
}

/** 记录可选日期 / 时间戳字段的格式问题。 */
function checkDateField(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  kind: 'date' | 'timestamp',
  problems: string[],
): void {
  const value = raw[key]
  if (value === undefined || value === null || value === '') return
  const valid = kind === 'date' ? isBusinessDate(value) : isIsoTimestampText(value)
  if (valid) return
  const expected = kind === 'date' ? '日期（YYYY-MM-DD）' : ' ISO-8601 时间戳（带时区）'
  problems.push(`${path}.${key} 不是合法的${expected}`)
}

/** 记录非负整数分字段的非法取值。 */
function checkCentsField(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  problems: string[],
): void {
  const value = raw[key]
  if (value === undefined || value === null) return
  if (readCents(value) === null) problems.push(`${path}.${key} 必须为非负整数分`)
}

/** 记录非负金额（元）字段的非法取值。 */
function checkYuanField(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  problems: string[],
): void {
  const value = raw[key]
  if (value === undefined || value === null || value === '') return
  if (legacyYuanToCents(value) === null) problems.push(`${path}.${key} 必须为非负数字`)
}

/**
 * 校验 v2 / v3 备份的字段级约束：非法值一律拒绝导入，缺失值仍交由幂等迁移补齐。
 * 在写入前执行，确保拒绝时不修改任何现有数据。
 * @param schemaVersion 备份数据结构版本
 * @param data 备份 data 部分
 * @param existingContractIds merge 模式下主库已有合同 id（replace 模式为空集）
 */
function assertModernDatasetValid(
  schemaVersion: DatasetSchemaVersion,
  data: LegacyDatasetData,
  existingContractIds: ReadonlySet<string>,
): void {
  if (schemaVersion < 2) return
  const problems: string[] = []
  const contracts = readArray(data.contracts)
  const declaredIds = declaredContractIds(contracts)

  contracts.forEach((raw, index) => {
    const path = `data.contracts[${index}]`
    if (!isPlainObject(raw)) {
      problems.push(`${path} 不是合法对象`)
      return
    }
    const direction = raw.direction
    if (direction !== undefined && direction !== null && direction !== '') {
      const text = readString(direction)
      if (text !== 'sale' && text !== 'purchase') {
        problems.push(
          `${path}.direction 取值非法：${JSON.stringify(direction)}（仅允许 sale / purchase）`,
        )
      }
    }
    checkYuanField(raw, 'deliveredAmount', path, problems)
    for (const key of [
      'deliveredCents',
      'openingDeliveredCents',
      'receivedAmountCents',
      'openingPaidCents',
      'paidCents',
    ]) {
      checkCentsField(raw, key, path, problems)
    }
    for (const key of ['signDate', 'startDate', 'dueDate']) {
      checkDateField(raw, key, path, 'date', problems)
    }
    for (const key of ['createdAt', 'updatedAt', 'statusChangedAt']) {
      checkDateField(raw, key, path, 'timestamp', problems)
    }
    if (raw.statusLogs !== undefined && !Array.isArray(raw.statusLogs)) {
      problems.push(`${path}.statusLogs 应为数组`)
    } else {
      readArray(raw.statusLogs).forEach((log, logIndex) => {
        const logPath = `${path}.statusLogs[${logIndex}]`
        if (!isPlainObject(log)) {
          problems.push(`${logPath} 不是合法对象`)
          return
        }
        for (const key of ['at', 'changedAt']) {
          checkDateField(log, key, logPath, 'timestamp', problems)
        }
      })
    }
  })

  readArray(data.payments).forEach((raw, index) => {
    const path = `data.payments[${index}]`
    if (!isPlainObject(raw)) {
      problems.push(`${path} 不是合法对象`)
      return
    }
    const contractId = readString(raw.contractId)
    if (contractId !== null && !declaredIds.has(contractId) && !existingContractIds.has(contractId)) {
      problems.push(`${path}.contractId 指向不存在的合同：${contractId}`)
    }
    checkDateField(raw, 'date', path, 'date', problems)
    for (const key of ['createdAt', 'updatedAt']) {
      checkDateField(raw, key, path, 'timestamp', problems)
    }
  })

  readArray(data.deliveries).forEach((raw, index) => {
    const path = `data.deliveries[${index}]`
    if (!isPlainObject(raw)) {
      problems.push(`${path} 不是合法对象`)
      return
    }
    const contractId = readString(raw.contractId)
    if (contractId === null) {
      problems.push(`${path}.contractId 缺失`)
    } else if (!declaredIds.has(contractId) && !existingContractIds.has(contractId)) {
      problems.push(`${path}.contractId 指向不存在的合同：${contractId}`)
    }
    const amountCents = readCents(raw.amountCents) ?? legacyYuanToCents(raw.amount)
    if (amountCents === null || amountCents <= 0) {
      problems.push(`${path}.amount 必须大于 0`)
    }
    if (raw.date === undefined || raw.date === null || raw.date === '') {
      problems.push(`${path}.date 缺失`)
    } else {
      checkDateField(raw, 'date', path, 'date', problems)
    }
    if (raw.status !== undefined && raw.status !== null && raw.status !== '') {
      const status = readString(raw.status)
      if (status !== 'delivered' && status !== 'accepted' && status !== 'rejected') {
        problems.push(`${path}.status 取值非法：${JSON.stringify(raw.status)}`)
      }
    }
    for (const key of ['createdAt', 'updatedAt']) {
      checkDateField(raw, key, path, 'timestamp', problems)
    }
  })

  if (problems.length > 0) {
    const lines = problems.slice(0, 20).join('\n- ')
    throw new Error(`导入失败（${problems.length} 项校验问题）：\n- ${lines}`)
  }
}

/** 替换模式：清空业务集合，保留 settings / meta / 审计 / 幂等 / 认证。 */
function clearBusinessRows(db: Database): void {
  db.exec(`
    DELETE FROM deliveries;
    DELETE FROM payments;
    DELETE FROM contract_status_logs;
    DELETE FROM contracts;
    DELETE FROM personnel;
    DELETE FROM dict_items;
    DELETE FROM dict_categories;
  `)
}

/** 记录一条跳过警告。 */
function skipRecord(report: ImportReport, label: string, index: number, reason: string): void {
  report.skipped += 1
  report.warnings.push(`${label}[${index}] 已跳过：${reason}`)
}

/** 创建字典上下文（合并模式预载现有分类与项）。 */
function createDictContext(
  repo: SqliteDictRepository,
  settings: unknown,
  nowText: string,
  mode: 'replace' | 'merge',
): DictContext {
  const categories = new Map<string, DictCategoryRow>()
  const items = new Map<string, DictItemRow>()
  if (mode === 'merge') {
    for (const category of repo.listCategories()) categories.set(category.code, category)
    for (const item of repo.listItems()) items.set(dictKey(item.categoryCode, item.code), item)
  }
  return { categories, items, metadata: readDictCategoryMetadata(settings), nowText }
}

/** 确保分类存在；缺失时按 name=code、builtin=0 创建。 */
function ensureCategory(repo: SqliteDictRepository, ctx: DictContext, code: string): DictCategoryRow {
  const existing = ctx.categories.get(code)
  if (existing) return existing
  const meta = ctx.metadata.get(code)
  const row: DictCategoryRow = {
    id: randomUUID(),
    code,
    name: meta?.name ?? code,
    builtin: meta?.builtin ?? false,
    sort: 0,
    createdAt: ctx.nowText,
    updatedAt: ctx.nowText,
  }
  repo.insertCategory(row)
  ctx.categories.set(code, row)
  return row
}

/** 确保字典项存在；缺失时按 name=code、enabled=1、builtin=0 创建。 */
function ensureDictItem(
  repo: SqliteDictRepository,
  ctx: DictContext,
  categoryCode: string,
  code: string,
): DictItemRow {
  const key = dictKey(categoryCode, code)
  const existing = ctx.items.get(key)
  if (existing) return existing
  ensureCategory(repo, ctx, categoryCode)
  const row: DictItemRow = {
    id: randomUUID(),
    categoryCode,
    code,
    name: code,
    color: '',
    sort: 0,
    enabled: true,
    builtin: false,
    note: '',
    createdAt: ctx.nowText,
    updatedAt: ctx.nowText,
  }
  repo.insertItem(row)
  ctx.items.set(key, row)
  return row
}

/** 导入备份中的字典项（保留旧版元信息并按 id 合并）。 */
function importDicts(
  repo: SqliteDictRepository,
  ctx: DictContext,
  rawDicts: unknown[],
  report: ImportReport,
): void {
  rawDicts.forEach((raw, index) => {
    if (!isPlainObject(raw)) return skipRecord(report, '字典', index, '不是合法对象')
    const id = readString(raw.id)
    const categoryCode = readString(raw.category) ?? readString(raw.categoryCode)
    const code = readString(raw.code)
    const name = readString(raw.name)
    if (!id || !categoryCode || !code || !name) {
      return skipRecord(report, '字典', index, '缺少 id / category / code / name')
    }
    ensureCategory(repo, ctx, categoryCode)
    const incoming: DictItemRow = {
      id,
      categoryCode,
      code,
      name,
      color: readStringOrEmpty(raw.color),
      sort: readFiniteNumber(raw.sort) ?? 0,
      enabled: readBoolean(raw.enabled, true),
      builtin: readBoolean(raw.builtin, false),
      note: readStringOrEmpty(raw.note),
      createdAt: isoTimestamp(raw.createdAt, ctx.nowText),
      updatedAt: isoTimestamp(raw.updatedAt, ctx.nowText),
    }
    const key = dictKey(categoryCode, code)
    const byId = repo.getItemById(id)
    const byKey = ctx.items.get(key)
    let saved = incoming
    if (byId) {
      repo.updateItem(incoming)
    } else if (byKey) {
      saved = { ...incoming, id: byKey.id }
      repo.updateItem(saved)
    } else {
      repo.insertItem(incoming)
    }
    ctx.items.set(key, saved)
    report.dicts += 1
  })
}

/** 导入人员档案并返回 id → 行映射。 */
function importPersonnel(
  repo: SqlitePersonnelRepository,
  rawPersonnel: unknown[],
  nowText: string,
  mode: 'replace' | 'merge',
  report: ImportReport,
): Map<string, PersonnelRow> {
  const byId = new Map<string, PersonnelRow>()
  const codes = new Set<string>()
  if (mode === 'merge') {
    for (const row of repo.list(true)) {
      byId.set(row.id, row)
      codes.add(row.code)
    }
  }
  rawPersonnel.forEach((raw, index) => {
    if (!isPlainObject(raw)) return skipRecord(report, '人员', index, '不是合法对象')
    const id = readString(raw.id)
    const code = readString(raw.code)
    const name = readString(raw.name)
    if (!id || !code || !name) return skipRecord(report, '人员', index, '缺少 id / code / name')
    const existing = byId.get(id)
    if (!existing && codes.has(code)) return skipRecord(report, '人员', index, `人员编号重复：${code}`)
    const row: PersonnelRow = {
      id,
      code,
      name,
      deptCode: readString(raw.deptCode) ?? readString(raw.departmentCode) ?? '',
      deptName: readStringOrEmpty(raw.deptName),
      position: readStringOrEmpty(raw.position),
      phone: readStringOrEmpty(raw.phone),
      email: readStringOrEmpty(raw.email),
      active: readBoolean(raw.active, true),
      hireDate: readString(raw.hireDate),
      note: readStringOrEmpty(raw.note),
      createdAt: isoTimestamp(raw.createdAt, nowText),
      updatedAt: isoTimestamp(raw.updatedAt, nowText),
    }
    if (existing) repo.update(row)
    else repo.insert(row)
    byId.set(id, row)
    codes.add(code)
    report.personnel += 1
  })
  return byId
}

/** 规范化资金流水；缺字段或非法金额返回 null。 */
function normalizePayment(raw: unknown, index: number, nowText: string, report: ImportReport): NormalizedPayment | null {
  if (!isPlainObject(raw)) {
    skipRecord(report, '资金流水', index, '不是合法对象')
    return null
  }
  const id = readString(raw.id)
  const contractId = readString(raw.contractId)
  if (!id || !contractId) {
    skipRecord(report, '资金流水', index, '缺少 id / contractId')
    return null
  }
  const amountCents = readCents(raw.amountCents) ?? legacyYuanToCents(raw.amount)
  if (amountCents === null || amountCents <= 0) {
    skipRecord(report, '资金流水', index, '金额非法或不为正数')
    return null
  }
  const date = readString(raw.date)
  if (!date) {
    skipRecord(report, '资金流水', index, '缺少日期')
    return null
  }
  return {
    row: {
      id,
      contractId,
      date,
      amountCents,
      methodCode: readString(raw.methodCode) ?? 'transfer',
      note: readStringOrEmpty(raw.note),
      createdAt: isoTimestamp(raw.createdAt, nowText),
      updatedAt: isoTimestamp(raw.updatedAt, nowText),
    },
  }
}

/** 规范化交付明细；缺字段或非法金额返回 null。 */
function normalizeDelivery(raw: unknown, index: number, nowText: string, report: ImportReport): NormalizedDelivery | null {
  if (!isPlainObject(raw)) {
    skipRecord(report, '交付明细', index, '不是合法对象')
    return null
  }
  const id = readString(raw.id)
  const contractId = readString(raw.contractId)
  if (!id || !contractId) {
    skipRecord(report, '交付明细', index, '缺少 id / contractId')
    return null
  }
  const amountCents = readCents(raw.amountCents) ?? legacyYuanToCents(raw.amount)
  if (amountCents === null || amountCents <= 0) {
    skipRecord(report, '交付明细', index, '金额非法或不为正数')
    return null
  }
  const date = readString(raw.date)
  if (!date) {
    skipRecord(report, '交付明细', index, '缺少日期')
    return null
  }
  const quantity = readFiniteNumber(raw.quantity)
  const status = readDeliveryStatus(raw.status)
  return {
    row: {
      id,
      contractId,
      date,
      amountCents,
      quantity: quantity !== null && quantity > 0 ? quantity : null,
      unit: readStringOrEmpty(raw.unit),
      status,
      note: readStringOrEmpty(raw.note),
      createdAt: isoTimestamp(raw.createdAt, nowText),
      updatedAt: isoTimestamp(raw.updatedAt, nowText),
    },
  }
}

/** 收集合同 id（含将被跳过但声明了 id 的记录）。 */
function declaredContractIds(rawContracts: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const raw of rawContracts) {
    if (!isPlainObject(raw)) continue
    const id = readString(raw.id)
    if (id) ids.add(id)
  }
  return ids
}

/** 按合同分组求和。 */
function sumPayments(plans: NormalizedPayment[]): Map<string, number> {
  const sums = new Map<string, number>()
  for (const plan of plans) {
    const current = sums.get(plan.row.contractId) ?? 0
    sums.set(plan.row.contractId, current + plan.row.amountCents)
  }
  return sums
}

/** 按合同分组求和非 rejected 交付金额。 */
function sumDeliveries(plans: NormalizedDelivery[]): Map<string, number> {
  const sums = new Map<string, number>()
  for (const plan of plans) {
    if (plan.row.status === 'rejected') continue
    const current = sums.get(plan.row.contractId) ?? 0
    sums.set(plan.row.contractId, current + plan.row.amountCents)
  }
  return sums
}

/** 状态日志是否已存在。 */
function statusLogExists(db: Database, id: string): boolean {
  const row = db
    .prepare<[string], { id: string }>('SELECT id FROM contract_status_logs WHERE id = ? LIMIT 1')
    .get(id)
  return row !== undefined
}

/** 构造合同写入行；缺必填字段返回 null（计入 skipped）。 */
function buildContractPlan(params: {
  raw: unknown
  index: number
  nowText: string
  actor: string
  dictRepo: SqliteDictRepository
  dictCtx: DictContext
  personnelById: Map<string, PersonnelRow>
  paymentSums: Map<string, number>
  deliverySums: Map<string, number>
  usedNos: Set<string>
  report: ImportReport
}): ContractPlan | null {
  const { raw, index, nowText, actor, dictRepo, dictCtx, personnelById, paymentSums, deliverySums, report } = params
  if (!isPlainObject(raw)) {
    skipRecord(report, '合同', index, '不是合法对象')
    return null
  }
  const id = readString(raw.id)
  const no = readString(raw.no)
  const counterparty = readString(raw.counterparty) ?? readString(raw.customer)
  const typeCode = readString(raw.typeCode)
  const statusCode = readString(raw.statusCode)
  const signDate = readString(raw.signDate)
  const dueDate = readString(raw.dueDate)
  if (!id || !no || !counterparty || !typeCode || !statusCode || !signDate || !dueDate) {
    skipRecord(report, '合同', index, '缺少 id / no / 对方 / 类型 / 状态 / 日期')
    return null
  }
  if (params.usedNos.has(no)) {
    skipRecord(report, '合同', index, `合同编号重复：${no}`)
    return null
  }
  const amountCents = readCents(raw.amountCents) ?? legacyYuanToCents(raw.amount)
  if (amountCents === null) {
    skipRecord(report, '合同', index, '合同金额非法')
    return null
  }
  const direction = readDirection(raw.direction, typeCode)
  const startDate = readString(raw.startDate) ?? signDate
  const ownerIdText = readString(raw.ownerId)
  const ownerId = ownerIdText !== null && personnelById.has(ownerIdText) ? ownerIdText : null
  const paymentSum = paymentSums.get(id) ?? 0
  const deliverySum = deliverySums.get(id) ?? 0
  const explicitOpeningPaid = readCents(raw.openingPaidCents)
  const receivedTarget =
    readCents(raw.receivedAmountCents) ?? readCents(raw.paidCents) ?? legacyYuanToCents(raw.receivedAmount) ?? 0
  const openingPaid = explicitOpeningPaid ?? Math.max(0, receivedTarget - paymentSum)
  const explicitOpeningDelivered = readCents(raw.openingDeliveredCents)
  const deliveredTarget = readCents(raw.deliveredCents) ?? legacyYuanToCents(raw.deliveredAmount) ?? 0
  const openingDelivered = explicitOpeningDelivered ?? Math.max(0, deliveredTarget - deliverySum)

  const typeItem = ensureDictItem(dictRepo, dictCtx, 'contractType', typeCode)
  const statusItem = ensureDictItem(dictRepo, dictCtx, 'contractStatus', statusCode)
  const createdAt = isoTimestamp(raw.createdAt, nowText)
  const updatedAt = isoTimestamp(raw.updatedAt, nowText)
  const logs = buildStatusLogs(raw.statusLogs, id, updatedAt, actor)
  const row: ContractRow = {
    id,
    no,
    projectName: readStringOrEmpty(raw.projectName),
    direction,
    counterparty,
    typeItemId: typeItem.id,
    typeCode,
    typeName: '',
    statusItemId: statusItem.id,
    statusCode,
    statusName: '',
    amountCents,
    openingPaidCents: openingPaid,
    paidCents: 0,
    unpaidCents: 0,
    receivedAmountCents: 0,
    openingDeliveredCents: openingDelivered,
    deliveredCents: 0,
    lastDeliveryDate: null,
    fundingPercent: null,
    deliveryPercent: null,
    executionGapCents: 0,
    gapState: 'none',
    ownerId,
    ownerName: readStringOrEmpty(raw.ownerName),
    note: readStringOrEmpty(raw.note),
    signDate,
    startDate,
    dueDate,
    statusChangedAt: readString(raw.statusChangedAt),
    createdAt,
    updatedAt,
  }
  return { row, logs }
}

/** 解析合同内嵌状态日志（兼容 v1/v2 `from/to/at/by` 与 v3 camelCase）。 */
function buildStatusLogs(
  rawLogs: unknown,
  contractId: string,
  fallbackAt: string,
  actor: string,
): ContractStatusLogRow[] {
  const logs: ContractStatusLogRow[] = []
  for (const raw of readArray(rawLogs)) {
    if (!isPlainObject(raw)) continue
    const toCode = readString(raw.toCode) ?? readString(raw.to)
    if (!toCode) continue
    logs.push({
      id: readString(raw.id) ?? randomUUID(),
      contractId,
      fromCode: readString(raw.fromCode) ?? readString(raw.from) ?? '',
      toCode,
      changedAt: readString(raw.changedAt) ?? readString(raw.at) ?? fallbackAt,
      actor: readString(raw.actor) ?? readString(raw.by) ?? actor,
      note: readStringOrEmpty(raw.note),
    })
  }
  return logs
}

/**
 * 导入数据集（单事务，失败整体回滚）。
 *
 * - 默认 `replace`：清空业务集合后全量写入；settings/审计/幂等/认证保持不变。
 * - `merge`：按 id 覆盖写入合同 / 流水 / 交付 / 人员 / 字典，状态日志按 id 去重。
 * - 旧版金额（元）按半进位转为整数分；开账余额 = max(0, 旧汇总 − 明细合计)。
 * @param db 数据库连接
 * @param payload 备份根对象
 * @param options 操作者、时间与导入模式
 * @returns 各集合写入条数与跳过警告
 */
export function importDataset(
  db: Database,
  payload: unknown,
  options: ImportOptions = {},
): ImportReport {
  const { schemaVersion, data } = validatePayload(payload)
  const mode = options.mode ?? 'replace'
  const nowText = nowIso(options.now ?? new Date())
  const actor = options.actor ?? 'system'
  const report: ImportReport = {
    contracts: 0,
    payments: 0,
    deliveries: 0,
    personnel: 0,
    dicts: 0,
    skipped: 0,
    warnings: [],
  }

  const runtime: RepoRuntime = createRepoRuntime(db)
  const contractsRepo = new SqliteContractRepository(runtime)
  const paymentsRepo = new SqlitePaymentRepository(runtime)
  const deliveriesRepo = new SqliteDeliveryRepository(runtime)
  const personnelRepo = new SqlitePersonnelRepository(runtime)
  const dictRepo = new SqliteDictRepository(runtime)
  const statusLogsRepo = new SqliteContractStatusLogRepository(runtime)

  // v2 / v3 备份先做字段级校验，拒绝时绝不进入写事务。
  const existingContractIds = new Set<string>()
  if (mode === 'merge') {
    for (const existing of contractsRepo.list()) existingContractIds.add(existing.id)
  }
  assertModernDatasetValid(schemaVersion, data, existingContractIds)

  db.exec('BEGIN IMMEDIATE')
  try {
    if (mode === 'replace') clearBusinessRows(db)

    const dictCtx = createDictContext(dictRepo, data.settings, nowText, mode)
    importDicts(dictRepo, dictCtx, readArray(data.dicts), report)
    const personnelById = importPersonnel(personnelRepo, readArray(data.personnel), nowText, mode, report)

    const paymentPlans: NormalizedPayment[] = []
    readArray(data.payments).forEach((raw, index) => {
      const plan = normalizePayment(raw, index, nowText, report)
      if (plan) paymentPlans.push(plan)
    })
    const deliveryPlans: NormalizedDelivery[] = []
    readArray(data.deliveries).forEach((raw, index) => {
      const plan = normalizeDelivery(raw, index, nowText, report)
      if (plan) deliveryPlans.push(plan)
    })

    const paymentSums = sumPayments(paymentPlans)
    const deliverySums = sumDeliveries(deliveryPlans)
    const rawContracts = readArray(data.contracts)
    const declaredIds = declaredContractIds(rawContracts)
    const existingIds = new Set<string>()
    const usedNos = new Set<string>()
    if (mode === 'merge') {
      for (const existing of contractsRepo.list()) {
        existingIds.add(existing.id)
      }
    }

    const contractPlans: ContractPlan[] = []
    rawContracts.forEach((raw, index) => {
      const plan = buildContractPlan({
        raw,
        index,
        nowText,
        actor,
        dictRepo,
        dictCtx,
        personnelById,
        paymentSums,
        deliverySums,
        usedNos,
        report,
      })
      if (!plan) return
      usedNos.add(plan.row.no)
      contractPlans.push(plan)
    })

    // 合同先落库：payments / deliveries / status_logs 均依赖其外键。
    for (const plan of contractPlans) {
      const existing = mode === 'merge' && existingIds.has(plan.row.id)
      writeContract(db, plan.row, () => {
        if (existing) contractsRepo.update(plan.row)
        else contractsRepo.insert(plan.row)
      })
      existingIds.add(plan.row.id)
      report.contracts += 1
    }

    for (const plan of paymentPlans) {
      if (!existingIds.has(plan.row.contractId)) {
        if (declaredIds.has(plan.row.contractId)) {
          report.skipped += 1
          report.warnings.push(`资金流水 ${plan.row.id} 已跳过：所属合同未能导入`)
          continue
        }
        throw new Error(`导入失败：资金流水 ${plan.row.id} 引用了不存在的合同 ${plan.row.contractId}`)
      }
      const existing = mode === 'merge' ? paymentsRepo.getById(plan.row.id) : null
      if (existing) paymentsRepo.delete(plan.row.id)
      paymentsRepo.insert(plan.row)
      report.payments += 1
    }

    for (const plan of deliveryPlans) {
      if (!existingIds.has(plan.row.contractId)) {
        if (declaredIds.has(plan.row.contractId)) {
          report.skipped += 1
          report.warnings.push(`交付明细 ${plan.row.id} 已跳过：所属合同未能导入`)
          continue
        }
        throw new Error(`导入失败：交付明细 ${plan.row.id} 引用了不存在的合同 ${plan.row.contractId}`)
      }
      const existing = mode === 'merge' ? deliveriesRepo.getById(plan.row.id) : null
      if (existing) deliveriesRepo.delete(plan.row.id)
      deliveriesRepo.insert(plan.row)
      report.deliveries += 1
    }

    for (const plan of contractPlans) {
      for (const log of plan.logs) {
        if (mode === 'merge' && statusLogExists(db, log.id)) continue
        statusLogsRepo.insert(log)
      }
    }

    db.exec('COMMIT')
    return report
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK')
    throw error
  }
}

/**
 * 写入合同；旧数据中「到期日早于开始日」违反 DB CHECK，但属于必须保留的历史数据，
 * 因此仅对该条语句临时关闭 CHECK 约束，其余记录仍受完整约束保护。
 * @param db 数据库连接
 * @param row 合同行（用起止日期判断是否需要放行）
 * @param write 实际写入动作
 */
function writeContract(db: Database, row: ContractRow, write: () => void): void {
  if (row.dueDate >= row.startDate) {
    write()
    return
  }
  db.pragma('ignore_check_constraints = ON')
  try {
    write()
  } finally {
    db.pragma('ignore_check_constraints = OFF')
  }
}
