import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Database } from './db.js'
import { openDatabase } from './db.js'
import { vacuumInto } from './migrate.js'

/** 备份参数。 */
export interface BackupOptions {
  /** 备份目录；缺省为数据库文件同级的 backups/。 */
  dir?: string
  /** 注入时间（测试用），缺省为当前时间。 */
  now?: Date
}

/** 备份结果。 */
export interface BackupResult {
  path: string
  bytes: number
}

/** 备份校验结果。 */
export interface BackupVerification {
  ok: boolean
  integrity: string
  counts: BackupCounts
}

/** 备份中的记录数快照。 */
export interface BackupCounts {
  contracts: number
  payments: number
  deliveries: number
  personnel: number
  dicts: number
}

/** 恢复参数。 */
export interface RestoreOptions {
  /** 目标已存在时是否覆盖；默认拒绝。 */
  overwrite?: boolean
}

/** 恢复结果。 */
export interface RestoreResult {
  path: string
  bytes: number
}

/** 每张表的计数 SQL（表名为硬编码常量，不接受外部输入）。 */
const COUNT_SQL = {
  contracts: 'SELECT COUNT(*) AS total FROM contracts',
  payments: 'SELECT COUNT(*) AS total FROM payments',
  deliveries: 'SELECT COUNT(*) AS total FROM deliveries',
  personnel: 'SELECT COUNT(*) AS total FROM personnel',
  dicts: 'SELECT COUNT(*) AS total FROM dict_items',
} as const

/** 默认备份目录：文件库使用同级 backups/，内存库退回进程工作目录。 */
function defaultBackupDir(db: Database): string {
  if (db.name && db.name !== ':memory:' && db.memory === false) {
    return path.join(path.dirname(db.name), 'backups')
  }
  return path.join(process.cwd(), 'backups')
}

/** 生成 ledger-YYYYMMDD-HHmmss-SSS 基础文件名（UTC）。 */
function backupBaseName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}` +
    `-${String(now.getUTCMilliseconds()).padStart(3, '0')}`
  return `ledger-${stamp}`
}

/** 选一个不存在的备份路径；冲突时追加 pid 与序号。 */
function uniqueBackupPath(dir: string, now: Date): string {
  const base = backupBaseName(now)
  const first = path.join(dir, `${base}.db`)
  if (!existsSync(first)) return first
  const withPid = path.join(dir, `${base}-${process.pid}.db`)
  if (!existsSync(withPid)) return withPid
  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(dir, `${base}-${process.pid}-${index}.db`)
    if (!existsSync(candidate)) return candidate
  }
  throw new Error(`无法为备份生成唯一文件名：${base}`)
}

/** 打开只读副本读取完整性检查结果。 */
function readIntegrity(file: string): string {
  const db = openDatabase({ file, readonly: true })
  try {
    return String(db.pragma('integrity_check', { simple: true }))
  } finally {
    db.close()
  }
}

/** 统计指定表的行数。 */
function countRows(db: Database, sql: string): number {
  const row = db.prepare<[], { total: number }>(sql).get()
  return row ? row.total : 0
}

/**
 * 用 VACUUM INTO 生成一致性备份，并对副本执行 integrity_check。
 * @param db 源数据库连接
 * @param options 备份目录与注入时间
 * @returns 备份路径与字节数
 */
export function backupDatabase(db: Database, options: BackupOptions = {}): BackupResult {
  const dir = options.dir ?? defaultBackupDir(db)
  mkdirSync(dir, { recursive: true })
  const destination = uniqueBackupPath(dir, options.now ?? new Date())
  vacuumInto(db, destination)
  const integrity = readIntegrity(destination)
  if (integrity !== 'ok') {
    throw new Error(`备份完整性检查失败：${integrity}（文件：${destination}）`)
  }
  return { path: destination, bytes: statSync(destination).size }
}

/**
 * 校验备份文件：完整性检查 + 关键表记录数。
 * @param file 备份文件路径
 */
export function verifyBackup(file: string): BackupVerification {
  const db = openDatabase({ file, readonly: true })
  try {
    const integrity = String(db.pragma('integrity_check', { simple: true }))
    return {
      ok: integrity === 'ok',
      integrity,
      counts: {
        contracts: countRows(db, COUNT_SQL.contracts),
        payments: countRows(db, COUNT_SQL.payments),
        deliveries: countRows(db, COUNT_SQL.deliveries),
        personnel: countRows(db, COUNT_SQL.personnel),
        dicts: countRows(db, COUNT_SQL.dicts),
      },
    }
  } finally {
    db.close()
  }
}

/**
 * 把备份复制到尚打不开的目标库位置。
 *
 * 目标必须尚未被任何连接打开（close-free）；复制使用 copyFileSync，
 * 不做额外 fsync——SQLite 在首次打开时会校验文件头与页结构。
 * @param source 源备份文件
 * @param target 目标数据库文件
 * @param options 覆盖策略
 */
export function restoreBackup(source: string, target: string, options: RestoreOptions = {}): RestoreResult {
  const verification = verifyBackup(source)
  if (!verification.ok) {
    throw new Error(`源备份完整性检查失败：${verification.integrity}（文件：${source}）`)
  }
  if (existsSync(target)) {
    if (options.overwrite !== true) {
      throw new Error(`目标数据库已存在，拒绝覆盖：${target}`)
    }
    // 目标未打开：删除主文件与可能残留的 WAL/SHM，避免旧日志污染新副本。
    rmSync(target, { force: true })
    rmSync(`${target}-wal`, { force: true })
    rmSync(`${target}-shm`, { force: true })
  }
  copyFileSync(source, target)
  return { path: target, bytes: statSync(target).size }
}
