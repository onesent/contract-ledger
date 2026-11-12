import type { Kysely } from 'kysely'
import type { Database } from '../db.js'
import type { DB } from '../generated/db.js'

/**
 * 仓储运行时依赖。
 *
 * store-port 的读接口是同步的（`read<T>(fn): T`），而 Kysely 的 `.execute()` 是异步的。
 * 因此这里同时持有：
 *  - `kysely`：只用于类型安全的 SQL 编译（`query.compile()`）；
 *  - `db`：better-sqlite3 同步连接，负责真正执行编译后的 SQL。
 * 二者指向同一个数据库连接，语义等价。
 */
export interface RepoRuntime {
  readonly db: Database
  readonly kysely: Kysely<DB>
}

/** Kysely 编译产物的结构子集（避免依赖内部类型导出）。 */
export interface CompiledQueryLike {
  readonly sql: string
  readonly parameters: ReadonlyArray<unknown>
}

/** 可同步编译的 Kysely 查询构建器。 */
export interface CompilableQuery {
  compile(): CompiledQueryLike
}

/**
 * 编译并同步执行查询，返回全部行。
 * @param runtime 仓储运行时
 * @param query 任意可编译的 Kysely 查询构建器
 * @returns 行数组（类型由调用方指定）
 */
export function executeAll<Row>(runtime: RepoRuntime, query: CompilableQuery): Row[] {
  const compiled = query.compile()
  const statement = runtime.db.prepare<unknown[], Row>(compiled.sql)
  if (!statement.reader) {
    statement.run(...compiled.parameters)
    return []
  }
  return statement.all(...compiled.parameters)
}

/**
 * 编译并同步执行写语句（INSERT / UPDATE / DELETE）。
 * @param runtime 仓储运行时
 * @param query 可编译的写查询构建器
 */
export function executeRun(runtime: RepoRuntime, query: CompilableQuery): void {
  const compiled = query.compile()
  runtime.db.prepare<unknown[], unknown>(compiled.sql).run(...compiled.parameters)
}

/** 把布尔值转为 SQLite 的 0/1 整数。 */
export function toSqliteBool(value: boolean): number {
  return value ? 1 : 0
}
