/**
 * CLI 台账打开与注册表装配：把数据目录、迁移、种子与存储一次性准备好。
 * 所有本地命令与领域命令共用这里的连接，保证迁移与种子行为一致。
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { CommandRegistry, registerCoreCommands } from '@ledger/core'
import {
  createLedgerStore,
  defaultMigrationsDir,
  migrateDatabase,
  openDatabase,
  seedDefaultDictionaries,
  type Database,
  type SqliteLedgerStore,
} from '@ledger/storage-sqlite'

/** 打开台账的选项：数据目录必填，迁移目录默认取 storage 包内置目录。 */
export interface OpenLedgerOptions {
  /** 数据目录；数据库文件为 `<dataDir>/ledger.db`。 */
  dataDir: string
  /** 迁移脚本目录；缺省使用 @ledger/storage-sqlite 内置迁移。 */
  migrationsDir?: string
}

/** 已打开的台账：连接与版本化存储共享同一条 SQLite 连接。 */
export interface OpenedLedger {
  db: Database
  store: SqliteLedgerStore
}

/**
 * 打开（必要时创建）台账数据库并完成迁移与首次种子写入。
 *
 * 迁移事务由 storage 层负责，**不做自动备份**（需要快照时用 `ledger backup`）；
 * 种子只在字典为空时写入，因此重复调用是幂等的。任一步失败都会关闭连接后原样抛出。
 * @param options 数据目录与可选迁移目录
 * @returns 已迁移、已种子化的数据库连接与存储
 */
export async function openLedger(options: OpenLedgerOptions): Promise<OpenedLedger> {
  const dataDir = path.resolve(options.dataDir)
  await mkdir(dataDir, { recursive: true })
  const db = openDatabase({ file: path.join(dataDir, 'ledger.db') })
  try {
    await migrateDatabase(db, {
      migrationsDir: options.migrationsDir ?? defaultMigrationsDir(),
    })
    seedDefaultDictionaries(db)
    const store = createLedgerStore(db)
    return { db, store }
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * 构造 CLI 命令注册表：与 HTTP / MCP 共用 core 的核心命令注册。
 * @returns 含全部 18 条核心命令的注册表
 */
export function createCliRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registerCoreCommands(registry)
  return registry
}
