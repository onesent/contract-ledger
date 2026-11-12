import DatabaseConstructor from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'

/**
 * better-sqlite3 的 Database 类型再导出，避免各仓储层重复依赖原生模块声明。
 */
export type Database = BetterSqlite3.Database

/** 打开数据库的参数。 */
export interface OpenDatabaseOptions {
  /** 文件路径；测试可用 ':memory:' 打开内存库。 */
  file: string
  /** 只读模式（备份检查、只读查询）；只读连接不修改 PRAGMA journal_mode。 */
  readonly?: boolean
}

/** SQLite 最低版本：3.7.0–3.51.2 存在 WAL checkpoint 并发损坏缺陷。 */
export const MIN_SQLITE_VERSION = '3.51.3'

/**
 * 解析 a.b.c 版本号为数字三元组，忽略预发布后缀。
 * @param value 版本号字符串
 * @returns 数字三元组
 */
function parseVersion(value: string): [number, number, number] {
  const parts = value.trim().split('.')
  return [
    Number.parseInt(parts[0] ?? '0', 10) || 0,
    Number.parseInt(parts[1] ?? '0', 10) || 0,
    Number.parseInt(parts[2] ?? '0', 10) || 0,
  ]
}

/**
 * 比较两个语义化版本号。
 * @returns 负数表示 a < b，0 表示相等，正数表示 a > b
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (l !== r) return l - r
  }
  return 0
}

/**
 * 读取当前连接的 SQLite 版本字符串。
 * @param db better-sqlite3 连接
 * @returns 形如 3.53.4 的版本号
 */
export function sqliteVersion(db: Database): string {
  const row = db.prepare<[], { version: string }>('SELECT sqlite_version() AS version').get()
  return row ? row.version : '0.0.0'
}

/**
 * 打开 SQLite 连接并应用统一 PRAGMA。
 *
 * - 文件库启用 WAL（内存库不支持），提升并发读性能；
 * - synchronous=NORMAL 在 WAL 下兼顾安全与吞吐；
 * - foreign_keys=ON 强制引用完整性（SQLite 默认关闭）；
 * - busy_timeout=5000 让多进程写入自动串行化等待；
 * - trusted_schema=OFF 禁止不可信 schema 触发内部函数调用。
 *
 * 打开后立即断言 SQLite 版本不低于 3.51.3。
 * @param options 文件路径与只读标记
 * @returns 已应用 PRAGMA 的数据库连接
 */
export function openDatabase(options: OpenDatabaseOptions): Database {
  const isMemory = options.file === ':memory:'
  const readonly = options.readonly === true
  const db = new DatabaseConstructor(options.file, readonly ? { readonly: true, fileMustExist: true } : {})
  // WAL 只对可写文件库有意义；内存库与只读连接跳过。
  if (!isMemory && !readonly) {
    db.pragma('journal_mode = WAL')
  }
  db.pragma('synchronous = NORMAL')
  db.pragma('trusted_schema = OFF')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  const version = sqliteVersion(db)
  if (compareVersions(version, MIN_SQLITE_VERSION) < 0) {
    db.close()
    throw new Error(
      `SQLite 版本过低：当前 ${version}，要求 ≥ ${MIN_SQLITE_VERSION}。` +
        'SQLite 3.7.0–3.51.2 存在 WAL checkpoint 并发损坏缺陷；' +
        '请把 better-sqlite3 升级到 13.0.3 或更高版本后重新执行 npm install。',
    )
  }
  return db
}
