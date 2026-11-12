import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  currentSchemaVersion,
  defaultMigrationsDir,
  latestMigrationVersion,
  migrateDatabase,
  openDatabase,
  type Database,
} from '../src/index.js'
import { createTestContext, disposeContext, type TestContext } from './helpers.js'

describe('Postgrator 迁移运行器', () => {
  let ctx: TestContext
  let extraDb: Database | null

  beforeEach(async () => {
    ctx = await createTestContext()
    extraDb = null
  })

  afterEach(() => {
    if (extraDb && extraDb.open) extraDb.close()
    extraDb = null
    disposeContext(ctx)
  })

  it('连续迁移两次：第二次应用 0 条且版本不变', async () => {
    const second = await migrateDatabase(ctx.db, { migrationsDir: defaultMigrationsDir() })
    expect(second.applied).toEqual([])
    expect(second.version).toBe('1')
    expect(currentSchemaVersion(ctx.db)).toBe('1')
  })

  it('迁移（含升级）不产生任何备份文件，备份只由 ledger backup 触发', async () => {
    const upgradeDir = path.join(ctx.dir, 'upgrade-002')
    mkdirSync(upgradeDir, { recursive: true })
    copyFileSync(
      path.join(defaultMigrationsDir(), '001_init.sql'),
      path.join(upgradeDir, '001_init.sql'),
    )
    writeFileSync(
      path.join(upgradeDir, '002_extra.sql'),
      'CREATE TABLE extra_002 (id TEXT PRIMARY KEY);',
      'utf8',
    )

    const upgraded = await migrateDatabase(ctx.db, { migrationsDir: upgradeDir })
    const rerun = await migrateDatabase(ctx.db, { migrationsDir: upgradeDir })

    expect(upgraded.applied).toEqual([2])
    expect(rerun.applied).toEqual([])
    expect(existsSync(path.join(ctx.dir, 'backups'))).toBe(false)
    expect(existsSync(path.join(path.dirname(ctx.file), 'backups'))).toBe(false)
  })

  it('篡改已应用迁移后校验和失败', async () => {
    const tamperedDir = path.join(ctx.dir, 'tampered')
    mkdirSync(tamperedDir, { recursive: true })
    const source = path.join(defaultMigrationsDir(), '001_init.sql')
    const target = path.join(tamperedDir, '001_init.sql')
    copyFileSync(source, target)
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n-- 篡改用于触发校验和失败\n`, 'utf8')

    await expect(
      migrateDatabase(ctx.db, { migrationsDir: tamperedDir }),
    ).rejects.toThrow(/MD5 checksum failed/)
    expect(currentSchemaVersion(ctx.db)).toBe('1')
  })

  it('迁移中途失败时整体回滚，不留下半张表', async () => {
    const badDir = path.join(ctx.dir, 'bad-fresh')
    mkdirSync(badDir, { recursive: true })
    copyFileSync(path.join(defaultMigrationsDir(), '001_init.sql'), path.join(badDir, '001_init.sql'))
    writeFileSync(
      path.join(badDir, '002_bad.sql'),
      ['CREATE TABLE partial_002 (id TEXT PRIMARY KEY);', "INSERT INTO table_that_does_not_exist (id) VALUES ('x');"].join(
        '\n',
      ),
      'utf8',
    )

    const file = path.join(ctx.dir, 'rollback-fresh.db')
    const db = openDatabase({ file })
    extraDb = db
    await expect(
      migrateDatabase(db, { migrationsDir: badDir }),
    ).rejects.toThrow()

    const partial = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_002'")
      .get()
    expect(partial).toBeUndefined()
    const contracts = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'contracts'")
      .get()
    expect(contracts).toBeUndefined()
    expect(currentSchemaVersion(db)).toBe('0')
  })

  it('已在版本 1 的库执行坏 002 后版本保持不变', async () => {
    const badDir = path.join(ctx.dir, 'bad-002')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(
      path.join(badDir, '002_bad.sql'),
      ['CREATE TABLE partial_002 (id TEXT PRIMARY KEY);', "INSERT INTO table_that_does_not_exist (id) VALUES ('x');"].join(
        '\n',
      ),
      'utf8',
    )

    await expect(
      migrateDatabase(ctx.db, { migrationsDir: badDir }),
    ).rejects.toThrow()

    const partial = ctx.db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_002'")
      .get()
    expect(partial).toBeUndefined()
    expect(currentSchemaVersion(ctx.db)).toBe('1')
  })
})

describe('迁移版本可读与目录覆盖', () => {
  it('latestMigrationVersion 返回目录内最大编号', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ledger-versions-'))
    try {
      expect(latestMigrationVersion(dir)).toBe(0)
      writeFileSync(path.join(dir, '001_init.sql'), 'SELECT 1;')
      expect(latestMigrationVersion(dir)).toBe(1)
      writeFileSync(path.join(dir, '002_add_column.sql'), 'SELECT 1;')
      writeFileSync(path.join(dir, '010_more.sql'), 'SELECT 1;')
      writeFileSync(path.join(dir, 'notes.txt'), 'ignored')
      expect(latestMigrationVersion(dir)).toBe(10)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('包内默认目录包含 001_init.sql', () => {
    expect(latestMigrationVersion(defaultMigrationsDir())).toBeGreaterThanOrEqual(1)
  })

  it('LEDGER_MIGRATIONS_DIR 覆盖默认目录', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ledger-override-'))
    const previous = process.env.LEDGER_MIGRATIONS_DIR
    try {
      process.env.LEDGER_MIGRATIONS_DIR = dir
      expect(defaultMigrationsDir()).toBe(path.resolve(dir))
      process.env.LEDGER_MIGRATIONS_DIR = ''
      expect(defaultMigrationsDir()).not.toBe(path.resolve(dir))
    } finally {
      if (previous === undefined) delete process.env.LEDGER_MIGRATIONS_DIR
      else process.env.LEDGER_MIGRATIONS_DIR = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
