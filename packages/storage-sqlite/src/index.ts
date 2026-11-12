/**
 * @ledger/storage-sqlite 公共入口。
 *
 * 暴露数据库连接、迁移运行器、Kysely 类型、仓储与合同视图读取层。
 * 写事务、幂等重放、审计与备份服务属于后续任务（3.4–3.6），不在本入口实现。
 */

// 数据库连接与 PRAGMA
export { MIN_SQLITE_VERSION, compareVersions, openDatabase, sqliteVersion } from './db.js'
export type { Database, OpenDatabaseOptions } from './db.js'

// 迁移
export {
  SCHEMA_VERSION_TABLE,
  currentSchemaVersion,
  defaultMigrationsDir,
  migrateDatabase,
  vacuumInto,
} from './migrate.js'
export type { MigrateOptions, MigrateResult } from './migrate.js'

// Kysely 与仓储运行时
export { createKysely, createRepoRuntime } from './kysely.js'
export type { CompilableQuery, CompiledQueryLike, RepoRuntime } from './repo/runtime.js'
export { executeAll, executeRun, toSqliteBool } from './repo/runtime.js'

// 仓储实现
export { SqliteContractRepository } from './repo/contracts.js'
export { SqliteDeliveryRepository } from './repo/deliveries.js'
export { SqliteDictRepository } from './repo/dicts.js'
export { SqlitePaymentRepository } from './repo/payments.js'
export { SqlitePersonnelRepository } from './repo/personnel.js'

// 契约行映射（供上层只读视图复用）
export {
  toContractRow,
  toDeliveryRow,
  toDictCategoryRow,
  toDictItemRow,
  toPaymentRow,
  toPersonnelRow,
} from './repo/mappers.js'

// 合同视图读取
export { buildContractViewQuery, getContractView, listContractViews } from './views.js'

// kysely-codegen 生成的库类型
export type { DB } from './generated/db.js'
