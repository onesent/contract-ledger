/**
 * ledger-server 启动流程：解析参数、打开并迁移数据库、装配应用、监听回环地址。
 * 启动时打印一次配对码（TTL 120 秒），供浏览器完成首次配对。
 */
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { CommandRegistry, registerCoreCommands } from '@ledger/core'
import {
  createLedgerStore,
  currentSchemaVersion,
  defaultMigrationsDir,
  latestMigrationVersion,
  migrateDatabase,
  openDatabase,
  seedDefaultDictionaries,
  type Database,
} from '@ledger/storage-sqlite'
import { PairingCodeService } from './auth/pair-code.js'
import { createApp } from './app.js'
import { assertNodeSupported, resolveBuildInfo } from './build-info.js'
import { DEFAULT_PORT, type AppOptions } from './types.js'

/** 回环地址白名单。 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost'])

/** 默认数据目录。 */
const DEFAULT_DATA_DIR = 'data'

/** 命令行选项。 */
export interface ServerCliOptions {
  dataDir: string
  port: number
  host: string
  /** 前端构建产物目录；未提供时不托管页面。 */
  webDir?: string
}

/**
 * 读取 `--name value` 形式的选项。
 * @param argv 参数列表
 * @param name 选项名（含 --）
 * @returns 选项值；未提供返回 undefined
 */
function readOption(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`选项 ${name} 缺少取值。`)
  }
  return value
}

/**
 * 解析并校验启动参数。
 * @param argv 不含 node 与脚本路径的参数
 * @returns 数据目录、端口与监听地址
 */
export function resolveServerOptions(argv: readonly string[]): ServerCliOptions {
  const dataDir = readOption(argv, '--data') ?? process.env.LEDGER_DATA_DIR ?? DEFAULT_DATA_DIR
  const portText = readOption(argv, '--port') ?? String(DEFAULT_PORT)
  const port = Number(portText)
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`--port 必须是 1..65535 的整数，当前为：${portText}`)
  }
  const host = readOption(argv, '--host') ?? '127.0.0.1'
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`--host 只允许回环地址（127.0.0.1 / ::1 / localhost），当前为：${host}`)
  }
  const webDir = readOption(argv, '--web-dir') ?? process.env.LEDGER_WEB_DIR
  return { dataDir, port, host, webDir }
}

/**
 * 降级保护：主库结构版本高于本程序内置的最新迁移时拒绝继续，避免旧代码写入新结构。
 * 属启动阶段失败，不是命令结果，因此不进入 ERROR_CATALOG。
 * @param db 数据库连接
 * @param migrationsDir 迁移目录
 * @param dataDir 数据目录（用于提示备份位置）
 */
export function assertSchemaCompatible(db: Database, migrationsDir: string, dataDir: string): void {
  const dbSchema = Number.parseInt(currentSchemaVersion(db), 10)
  const programSchema = latestMigrationVersion(migrationsDir)
  if (!Number.isSafeInteger(dbSchema) || programSchema <= 0) return
  if (dbSchema <= programSchema) return
  throw new Error(
    `数据库结构版本（${dbSchema}）高于本程序支持的最新版本（${programSchema}），已拒绝启动以避免写入不兼容数据。` +
      `请改用更新版本的程序，或用升级前备份恢复数据（备份目录：${path.join(dataDir, 'backups')}）。`,
  )
}

/**
 * 启动本地服务。
 * @param argv 命令行参数（不含 node 与脚本路径）
 * @returns 启动完成后的服务器句柄
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const buildInfo = resolveBuildInfo()
  // --version 只打印版本并以 0 退出，不打开数据库、不监听端口。
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`ledger-server ${buildInfo.version}\n`)
    return
  }
  assertNodeSupported(process.versions.node, buildInfo.minNodeVersion)
  const options = resolveServerOptions(argv)
  const dataDir = path.resolve(options.dataDir)
  const webDir = options.webDir === undefined ? undefined : path.resolve(options.webDir)
  if (webDir !== undefined && !existsSync(webDir)) {
    throw new Error(`--web-dir 指向的目录不存在：${webDir}`)
  }
  mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'ledger.db')
  const db = openDatabase({ file: dbFile })

  try {
    const migrationsDir = defaultMigrationsDir()
    assertSchemaCompatible(db, migrationsDir, dataDir)
    await migrateDatabase(db, { migrationsDir })
    seedDefaultDictionaries(db)
    const store = createLedgerStore(db)
    const registry = new CommandRegistry()
    registerCoreCommands(registry)
    const pairing = new PairingCodeService()
    const appOptions: AppOptions = {
      store,
      db,
      registry,
      pairing,
      port: options.port,
      host: options.host,
      webDir,
      version: buildInfo.version,
    }
    const app = createApp(appOptions)
    const issued = pairing.issue()

    serve(
      {
        fetch: app.fetch,
        hostname: options.host,
        port: options.port,
      },
      () => {
        process.stdout.write(`ledger-server 已启动：http://${options.host}:${options.port}\n`)
        process.stdout.write(`一次性配对码：${issued.code}（有效期 120 秒，过期时间 ${issued.expiresAt}）\n`)
      },
    )
  } catch (error) {
    if (db.open) db.close()
    throw error
  }
}
