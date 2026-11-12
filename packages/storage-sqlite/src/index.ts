/**
 * @ledger/storage-sqlite 公共入口。
 *
 * 暴露数据库连接、迁移运行器、Kysely 类型、仓储、合同视图读取层、
 * 版本化写事务（幂等 + 审计）与备份/恢复工具。
 */

// 数据库连接与 PRAGMA
export { MIN_SQLITE_VERSION, compareVersions, openDatabase, sqliteVersion } from './db.js'
export type { Database, OpenDatabaseOptions } from './db.js'

// 迁移
export {
  SCHEMA_VERSION_TABLE,
  currentSchemaVersion,
  defaultMigrationsDir,
  latestMigrationVersion,
  migrateDatabase,
  vacuumInto,
} from './migrate.js'
export type { MigrateOptions, MigrateResult } from './migrate.js'

// 版本化写事务（幂等 + 审计）
export { SqliteLedgerStore, auditRows, createLedgerStore, readDatasetVersion } from './store.js'
export type { AuditRow, LedgerRepositories } from './store.js'

// 备份与恢复
export { backupDatabase, restoreBackup, verifyBackup } from './backup.js'
export type {
  BackupCounts,
  BackupOptions,
  BackupResult,
  BackupVerification,
  RestoreOptions,
  RestoreResult,
} from './backup.js'

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
export { SqliteContractStatusLogRepository, toStatusLogRow } from './repo/status-logs.js'
export type { StatusLogRecord } from './repo/status-logs.js'

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

// 默认字典与设置种子
export { seedDefaultDictionaries } from './seed.js'
export type { SeedResult } from './seed.js'

// 数据集导入 / 导出
export { DATASET_APP, DATASET_SCHEMA_VERSION, exportDataset, importDataset } from './dataset.js'
export type {
  DatasetDictRow,
  DatasetExport,
  DatasetSchemaVersion,
  ImportOptions,
  ImportReport,
  LegacyContract,
  LegacyDatasetData,
  LegacyDatasetPayload,
  LegacyDelivery,
  LegacyDict,
  LegacyDictCategory,
  LegacyPayment,
  LegacyPersonnel,
  LegacyStatusLog,
} from './dataset.js'

// kysely-codegen 生成的库类型
export type { DB } from './generated/db.js'
