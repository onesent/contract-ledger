/**
 * 启动期降级保护：主库结构版本高于程序内置迁移时拒绝启动，且不改动数据库。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  currentSchemaVersion,
  defaultMigrationsDir,
  openDatabase,
  SCHEMA_VERSION_TABLE,
  type Database,
} from '@ledger/storage-sqlite'
import { assertSchemaCompatible, main } from '../src/main.js'

/** 临时数据目录列表。 */
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

/**
 * 创建临时数据目录。
 * @returns 目录路径
 */
function tempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-downgrade-'))
  dirs.push(dir)
  return dir
}

/**
 * 造一个结构版本被抬高到 999 的数据库（模拟更新版本创建过的库）。
 * @param dataDir 数据目录
 * @returns 数据库文件路径
 */
function createFutureDatabase(dataDir: string): string {
  const file = path.join(dataDir, 'ledger.db')
  const db: Database = openDatabase({ file })
  db.exec(
    `CREATE TABLE ${SCHEMA_VERSION_TABLE} (
       version INTEGER NOT NULL,
       description TEXT,
       name TEXT,
       md5 TEXT,
       run_at TEXT
     )`,
  )
  db.prepare<[number, string, string, string]>(
    `INSERT INTO ${SCHEMA_VERSION_TABLE} (version, description, name, md5, run_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(999, 'future schema', '999_future', 'deadbeef', new Date().toISOString())
  db.close()
  return file
}

describe('降级保护', () => {
  it('库版本高于程序最新迁移时抛错并提示备份目录', () => {
    const dataDir = tempDataDir()
    const file = createFutureDatabase(dataDir)
    const db = openDatabase({ file })
    try {
      expect(() => assertSchemaCompatible(db, defaultMigrationsDir(), dataDir)).toThrow(
        /数据库结构版本（999）高于本程序支持的最新版本/,
      )
      expect(() => assertSchemaCompatible(db, defaultMigrationsDir(), dataDir)).toThrow(/backups/)
    } finally {
      db.close()
    }
  })

  it('库版本不高于程序最新迁移时放行', () => {
    const dataDir = tempDataDir()
    const file = path.join(dataDir, 'ledger.db')
    const db = openDatabase({ file })
    try {
      // 空库（无 schemaversion 表）视为 0，不触发保护
      expect(() => assertSchemaCompatible(db, defaultMigrationsDir(), dataDir)).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('启动被拒绝且数据库内容未被修改', async () => {
    const dataDir = tempDataDir()
    const file = createFutureDatabase(dataDir)
    await expect(main(['--data', dataDir, '--port', '4620'])).rejects.toThrow(/数据库结构版本/)

    const db = openDatabase({ file })
    try {
      expect(currentSchemaVersion(db)).toBe('999')
      const business = db
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get('contracts')
      expect(business).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
