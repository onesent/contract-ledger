import { Kysely, SqliteDialect } from 'kysely'
import type { Database } from './db.js'
import type { DB } from './generated/db.js'
import type { RepoRuntime } from './repo/runtime.js'

/**
 * 构造 Kysely 实例（SQLite 方言，复用同一个 better-sqlite3 连接）。
 *
 * 注意：仓储的同步读接口使用 `query.compile()` + better-sqlite3 执行，
 * 不会调用 Kysely 的异步 `.execute()`；Kysely 在这里承担类型安全的 SQL 编译。
 * @param db 已打开的数据库连接
 */
export function createKysely(db: Database): Kysely<DB> {
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: db }) })
}

/**
 * 构造仓储运行时（数据库连接 + Kysely 编译器）。
 * @param db 已打开的数据库连接
 */
export function createRepoRuntime(db: Database): RepoRuntime {
  return { db, kysely: createKysely(db) }
}
