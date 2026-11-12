#!/usr/bin/env node
/**
 * ledger-mcp 可执行入口：打开 SQLite 台账、执行迁移并启动 stdio MCP server。
 * 默认 v2 协议；`--legacy` 使用 v1 SDK。数据库路径可用 --db 或 LEDGER_DB 覆盖。
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  createLedgerStore,
  defaultMigrationsDir,
  migrateDatabase,
  openDatabase,
  seedDefaultDictionaries,
} from '@ledger/storage-sqlite'
import { createCoreRegistry } from './registry.js'
import { runStdio } from './server.js'

/** 解析后的命令行选项。 */
interface CliOptions {
  legacy: boolean
  dbFile: string
  actor: string
}

/** 默认数据库文件（相对当前工作目录）。 */
const DEFAULT_DB_FILE = path.join('data', 'ledger.db')

/** 默认操作者。 */
const DEFAULT_ACTOR = 'mcp:stdio'

/**
 * 读取 `--name value` 形式的选项。
 * @param argv 参数列表
 * @param name 选项名（含 --）
 * @returns 选项值；未提供返回 undefined
 */
function readOption(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  return argv[index + 1]
}

/**
 * 解析命令行参数。
 * @param argv 不含 node 与脚本路径的参数
 * @returns 协议开关、数据库路径与操作者
 */
function resolveOptions(argv: readonly string[]): CliOptions {
  return {
    legacy: argv.includes('--legacy'),
    dbFile: readOption(argv, '--db') ?? process.env.LEDGER_DB ?? DEFAULT_DB_FILE,
    actor: readOption(argv, '--actor') ?? process.env.LEDGER_ACTOR ?? DEFAULT_ACTOR,
  }
}

/**
 * 程序主流程：打开连接、迁移、启动 server。
 * @returns 启动完成后保持进程运行
 */
async function main(): Promise<void> {
  const options = resolveOptions(process.argv.slice(2))
  const dbFile = path.resolve(options.dbFile)
  mkdirSync(path.dirname(dbFile), { recursive: true })
  const db = openDatabase({ file: dbFile })
  try {
    await migrateDatabase(db, { migrationsDir: defaultMigrationsDir() })
    // 与 server/CLI 保持一致：空库先写入默认字典，agent 可直接 upsert 合同。
    seedDefaultDictionaries(db)
    const store = createLedgerStore(db)
    await runStdio({
      registry: createCoreRegistry(),
      store,
      actor: options.actor,
      legacy: options.legacy,
    })
  } catch (error) {
    db.close()
    throw error
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`ledger-mcp: 启动失败：${message}\n`)
  process.exitCode = 1
})
