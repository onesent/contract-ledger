import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  currentSchemaVersion,
  defaultMigrationsDir,
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
    const second = await migrateDatabase(ctx.db, {
      migrationsDir: defaultMigrationsDir(),
      backupDir: path.join(ctx.dir, 'backups'),
    })
    expect(second.applied).toEqual([])
    expect(second.version).toBe('1')
    expect(currentSchemaVersion(ctx.db)).toBe('1')
  })

  it('篡改已应用迁移后校验和失败', async () => {
    const tamperedDir = path.join(ctx.dir, 'tampered')
    mkdirSync(tamperedDir, { recursive: true })
    const source = path.join(defaultMigrationsDir(), '001_init.sql')
    const target = path.join(tamperedDir, '001_init.sql')
    copyFileSync(source, target)
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n-- 篡改用于触发校验和失败\n`, 'utf8')

    await expect(
      migrateDatabase(ctx.db, {
        migrationsDir: tamperedDir,
        backupDir: path.join(ctx.dir, 'backups'),
      }),
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
      migrateDatabase(db, { migrationsDir: badDir, backupDir: path.join(ctx.dir, 'backups') }),
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
      migrateDatabase(ctx.db, { migrationsDir: badDir, backupDir: path.join(ctx.dir, 'backups') }),
    ).rejects.toThrow()

    const partial = ctx.db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_002'")
      .get()
    expect(partial).toBeUndefined()
    expect(currentSchemaVersion(ctx.db)).toBe('1')
  })
})
