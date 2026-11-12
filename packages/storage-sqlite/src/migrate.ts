import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Postgrator from 'postgrator'
import type { Database } from './db.js'

/** 迁移执行参数。 */
export interface MigrateOptions {
  /** 迁移脚本目录（glob 匹配目录下的 *.sql）。 */
  migrationsDir: string
}

/** 迁移结果。 */
export interface MigrateResult {
  /** 本次实际应用的迁移版本号（已按升序）。 */
  applied: number[]
  /** 迁移后的当前 schema 版本（来自 Postgrator 的 schemaversion 表）。 */
  version: string
}

/** Postgrator 记录迁移版本的默认表名。 */
export const SCHEMA_VERSION_TABLE = 'schemaversion'

/**
 * Postgrator 要求迁移文件名形如 `001.do.sql` / `001.undo.sql`（版本.动作.名称）。
 * 本项目把迁移文件命名为更直观的 `001_init.sql`，因此这里复制到临时目录并补上
 * `.do.` 动作段。复制内容与源文件完全一致，MD5 校验和因此仍然对源文件生效。
 * @param migrationsDir 源迁移目录
 * @returns 临时目录与清理函数
 */
function stageMigrations(migrationsDir: string): { dir: string; cleanup: () => void } {
  const stagedDir = mkdtempSync(path.join(tmpdir(), 'ledger-migrations-'))
  for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
    const base = name.slice(0, -'.sql'.length)
    let stagedName = name
    if (!/^\d+\.(do|undo)\./.test(base)) {
      const version = /^(\d+)/.exec(base)?.[1]
      if (!version) continue
      const rest = base.slice(version.length).replace(/^[_-]/, '')
      stagedName = rest === '' ? `${version}.do.sql` : `${version}.do.${rest}.sql`
    }
    copyFileSync(path.join(migrationsDir, name), path.join(stagedDir, stagedName))
  }
  return { dir: stagedDir, cleanup: () => rmSync(stagedDir, { recursive: true, force: true }) }
}

/** 把目录路径转成 glob 可识别的正斜杠形式。 */
function toMigrationPattern(migrationsDir: string): string {
  const normalized = migrationsDir.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${normalized}/*.sql`
}

/** 把文件路径转义为 SQL 字符串字面量。 */
function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * 用 VACUUM INTO 生成一份一致的数据库副本（不阻塞写入）。
 * 目标文件必须不存在，否则 SQLite 会报错以避免覆盖。
 * 仅供 `ledger backup` / 数据集导出等显式备份入口调用；迁移不再自动备份。
 * @param db 源数据库连接
 * @param destination 目标文件路径
 */
export function vacuumInto(db: Database, destination: string): void {
  db.exec(`VACUUM INTO ${quoteSqlString(destination)}`)
}

/**
 * 读取当前 schema 版本；schemaversion 表不存在时视为 0。
 * @param db 数据库连接
 * @returns 版本号字符串（无迁移时为 '0'）
 */
export function currentSchemaVersion(db: Database): string {
  const table = db
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(SCHEMA_VERSION_TABLE)
  if (!table) return '0'
  const row = db
    .prepare<[], { version: number }>(
      `SELECT version FROM ${SCHEMA_VERSION_TABLE} ORDER BY version DESC LIMIT 1`,
    )
    .get()
  return row ? String(row.version) : '0'
}

/**
 * 执行 Postgrator 迁移：
 * 1. BEGIN IMMEDIATE 串行化多进程迁移；
 * 2. 运行带 MD5 校验和的迁移脚本；
 * 3. 成功 COMMIT，失败 ROLLBACK 后原样抛出。
 *
 * 迁移本身不做备份：日常打开台账（CLI / server / MCP 每次启动）都会走这里，
 * 自动快照会让 `data/backups` 无限制膨胀。需要快照时显式执行 `ledger backup`。
 * @param db 已打开的数据库连接（PRAGMA 由 openDatabase 应用）
 * @param options 迁移目录
 * @returns 已应用版本列表与迁移后的 schema 版本
 */
export async function migrateDatabase(db: Database, options: MigrateOptions): Promise<MigrateResult> {
  const staged = stageMigrations(options.migrationsDir)
  const postgrator = new Postgrator({
    driver: 'sqlite3',
    migrationPattern: toMigrationPattern(staged.dir),
    validateChecksums: true,
    execQuery: (query: string): Promise<{ rows: unknown[] }> => {
      const statement = db.prepare<[], unknown>(query)
      if (statement.reader) {
        return Promise.resolve({ rows: statement.all() })
      }
      statement.run()
      return Promise.resolve({ rows: [] })
    },
    execSqlScript: (sqlScript: string): Promise<void> => {
      db.exec(sqlScript)
      return Promise.resolve()
    },
  })

  db.exec('BEGIN IMMEDIATE')
  try {
    const migrations = await postgrator.migrate()
    db.exec('COMMIT')
    return {
      applied: migrations.map((migration) => migration.version),
      version: currentSchemaVersion(db),
    }
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK')
    throw error
  } finally {
    staged.cleanup()
  }
}

/**
 * 包内默认迁移目录：src/ 与 dist/ 都位于包根下一层，因此上一级的 migrations 恒定。
 * @returns 绝对路径
 */
export function defaultMigrationsDir(): string {
  return fileURLToPath(new URL('../migrations', import.meta.url))
}
