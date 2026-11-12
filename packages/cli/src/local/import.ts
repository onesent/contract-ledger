/**
 * 备份导入：读取 legacy / v3 备份 JSON，规范化旧版非 UUID 主键后，
 * 交给 storage 的 `importDataset` 在单事务内完成映射与写入。
 *
 * 为什么需要主键规范化：旧版浏览器备份使用 `p...` / `pay-0001` / `log-001`
 * 这类非 UUID 主键，而 agent 命令的输出 schema 要求 UUID。CLI 在导入边界
 * 把这些主键确定性地改写成 UUID（同一旧 id 永远得到同一新 id），并同步改绑
 * 外键，既保留关系，又让导入后的数据可被所有命令读取。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { LedgerError } from '@ledger/core'
import { importDataset, type Database, type ImportReport } from '@ledger/storage-sqlite'

/** 导入模式：替换全部业务数据，或按 id 合并。 */
export type ImportMode = 'replace' | 'merge'

/** 导入选项。 */
export interface ImportLedgerOptions {
  /** 备份 JSON 文件路径。 */
  backupPath: string
  /** 操作者（写入状态日志兜底）。 */
  actor?: string
  /** 导入模式；缺省 replace。 */
  mode?: ImportMode
}

/** 导入结果：报告 + 实际生效模式。 */
export interface ImportLedgerResult extends ImportReport {
  mode: ImportMode
}

/** 判断值是否为普通 JSON 对象（排除 null 与数组）。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** RFC 9562 UUID 文本形态。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 判断字符串是否已是合法 UUID。 */
function isUuidText(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/**
 * 由「实体名 + 旧 id」生成稳定 UUID（版本 4 形态 + RFC 变体）。
 * 同一旧 id 多次导入得到同一新 id，避免 merge 模式产生重复记录。
 * @param namespace 实体名，避免不同集合的同名旧 id 冲突
 * @param legacyId 旧版主键
 * @returns 稳定 UUID
 */
function stableUuid(namespace: string, legacyId: string): string {
  const hash = createHash('sha256').update(`${namespace}\u0000${legacyId}`, 'utf8').digest('hex')
  const variant = ((Number.parseInt(hash.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

/**
 * 规范化记录 id：合法 UUID 原样保留，旧格式按命名空间稳定改写。
 * 缺失或空 id 原样返回，交由 storage 按记录级错误跳过。
 */
function remapId(
  namespace: string,
  map: Map<string, string>,
  raw: unknown,
): unknown {
  if (typeof raw !== 'string' || raw === '') return raw
  if (isUuidText(raw)) return raw
  const existing = map.get(raw)
  if (existing !== undefined) return existing
  const generated = stableUuid(namespace, raw)
  map.set(raw, generated)
  return generated
}

/** 按旧 id → 新 id 映射改写外键；未命中的值原样保留。 */
function remapReference(map: Map<string, string>, raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  return map.get(raw) ?? raw
}

/**
 * 规范化一组合集：复制记录、改写 id 并执行额外的引用改绑。
 * @param namespace 实体名
 * @param value 原始数组（非数组原样返回）
 * @param idMap 收集旧 id → 新 id 的映射
 * @param rewrite 额外的字段改绑逻辑
 */
function remapCollection(
  namespace: string,
  value: unknown,
  idMap: Map<string, string>,
  rewrite: (copy: Record<string, unknown>) => void,
): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item) => {
    if (!isPlainRecord(item)) return item
    const copy: Record<string, unknown> = { ...item }
    copy.id = remapId(namespace, idMap, copy.id)
    rewrite(copy)
    return copy
  })
}

/** 改写合同内嵌状态日志的 id（日志 id 同样要求 UUID）。 */
function remapStatusLogs(copy: Record<string, unknown>): void {
  const logs = copy.statusLogs
  if (!Array.isArray(logs)) return
  const logIds = new Map<string, string>()
  copy.statusLogs = logs.map((log) => {
    if (!isPlainRecord(log)) return log
    const next: Record<string, unknown> = { ...log }
    next.id = remapId('statusLog', logIds, next.id)
    return next
  })
}

/**
 * 规范化备份 data 部分：先处理被引用的集合（人员、字典），再处理合同、
 * 流水与交付，确保外键改写使用已确定的新 id。
 */
function normalizeData(data: Record<string, unknown>): Record<string, unknown> {
  const personnelIds = new Map<string, string>()
  const dictIds = new Map<string, string>()
  const contractIds = new Map<string, string>()

  const personnel = remapCollection('personnel', data.personnel, personnelIds, () => {})
  const dicts = remapCollection('dict', data.dicts, dictIds, () => {})
  const contracts = remapCollection('contract', data.contracts, contractIds, (copy) => {
    copy.ownerId = remapReference(personnelIds, copy.ownerId)
    copy.typeItemId = remapReference(dictIds, copy.typeItemId)
    copy.statusItemId = remapReference(dictIds, copy.statusItemId)
    remapStatusLogs(copy)
  })
  const payments = remapCollection(
    'payment',
    data.payments,
    new Map<string, string>(),
    (copy) => {
      copy.contractId = remapReference(contractIds, copy.contractId)
    },
  )
  const deliveries = remapCollection(
    'delivery',
    data.deliveries,
    new Map<string, string>(),
    (copy) => {
      copy.contractId = remapReference(contractIds, copy.contractId)
    },
  )

  return { ...data, personnel, dicts, contracts, payments, deliveries }
}

/**
 * 规范化整份备份根对象；结构不符时原样返回，由 storage 给出结构错误。
 * @param payload 备份根对象
 * @returns 主键已规范化的新对象
 */
function normalizeBackupPayload(payload: unknown): unknown {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.data)) return payload
  return { ...payload, data: normalizeData(payload.data) }
}

/**
 * 解析导入模式；非法值抛出参数校验错误。
 * @param value 原始模式
 * @returns 合法模式
 */
export function normalizeImportMode(value: string | undefined): ImportMode {
  if (value === undefined || value === 'replace') return 'replace'
  if (value === 'merge') return 'merge'
  throw new LedgerError('VALIDATION_FAILED', '导入模式只支持 replace 或 merge。')
}

/**
 * 读取备份文件并导入。
 * @param db 数据库连接
 * @param options 备份路径、操作者与模式
 * @returns 各集合写入条数、跳过警告与模式
 * @throws {LedgerError} 文件不是合法 JSON 或备份结构不合法
 */
export async function importLedger(
  db: Database,
  options: ImportLedgerOptions,
): Promise<ImportLedgerResult> {
  const text = await readFile(options.backupPath, 'utf8')
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new LedgerError('VALIDATION_FAILED', `备份文件不是合法 JSON：${options.backupPath}`)
  }

  const mode = normalizeImportMode(options.mode)
  try {
    const report = importDataset(db, normalizeBackupPayload(payload), {
      actor: options.actor ?? 'cli:local',
      mode,
    })
    return { ...report, mode }
  } catch (error) {
    // 数据集结构校验失败属于入参问题，映射为稳定的 VALIDATION_FAILED。
    if (error instanceof LedgerError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new LedgerError('VALIDATION_FAILED', `备份导入失败：${message}`)
  }
}
