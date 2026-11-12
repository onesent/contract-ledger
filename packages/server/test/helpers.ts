import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  defaultMigrationsDir,
  migrateDatabase,
  openDatabase,
  type Database,
} from '@ledger/storage-sqlite'

/**
 * 认证测试上下文：临时目录 + 文件库 + 已执行的 001 迁移。
 * 不跨包复用 storage 的测试助手，避免测试之间产生耦合。
 */
export interface AuthTestContext {
  dir: string
  file: string
  db: Database
}

/** 固定测试时间。 */
export const NOW = '2026-01-01T00:00:00.000Z'

/**
 * 创建独立的临时数据库；调用方必须在 afterEach 中 dispose。
 * @returns 已迁移的测试上下文
 */
export async function createAuthTestContext(): Promise<AuthTestContext> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-server-auth-'))
  const file = path.join(dir, 'ledger.db')
  const db = openDatabase({ file })
  await migrateDatabase(db, {
    migrationsDir: defaultMigrationsDir(),
  })
  return { dir, file, db }
}

/**
 * 关闭连接并删除临时目录。
 * @param ctx 测试上下文
 */
export function disposeAuthTestContext(ctx: AuthTestContext): void {
  if (ctx.db.open) ctx.db.close()
  rmSync(ctx.dir, { recursive: true, force: true })
}
