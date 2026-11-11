import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Node.js 最低版本（better-sqlite3 13.x 的预编译与 ESM 行为基线）。 */
export const MIN_NODE_VERSION = '24.18.0'

/** SQLite 最低版本（3.7.0–3.51.2 存在 WAL checkpoint 并发损坏缺陷）。 */
export const MIN_SQLITE_VERSION = '3.51.3'

/**
 * 从 @ledger/storage-sqlite 解析 better-sqlite3。
 * better-sqlite3 由 storage-sqlite 依赖持有（根级安装会与 kysely-codegen 的
 * peerOptional <13.0.0 冲突），这里以存储包为锚点解析，避免重复安装原生模块。
 * @returns {typeof import('better-sqlite3')}
 */
export function loadBetterSqlite3() {
  const requireFromStorage = createRequire(new URL('../packages/storage-sqlite/package.json', import.meta.url))
  return requireFromStorage('better-sqlite3')
}

/**
 * 解析 a.b.c 版本号为数字三元组，忽略预发布后缀。
 * @param {string} value 版本号字符串
 * @returns {[number, number, number]}
 */
function parseVersion(value) {
  const parts = String(value).trim().split('.')
  return [
    Number.parseInt(parts[0] ?? '0', 10) || 0,
    Number.parseInt(parts[1] ?? '0', 10) || 0,
    Number.parseInt(parts[2] ?? '0', 10) || 0,
  ]
}

/**
 * 判断 actual 是否低于 minimum。
 * @param {string} actual 实际版本号
 * @param {string} minimum 最低版本号
 * @returns {boolean}
 */
function isBelow(actual, minimum) {
  const current = parseVersion(actual)
  const required = parseVersion(minimum)
  for (let i = 0; i < 3; i += 1) {
    const a = current[i] ?? 0
    const b = required[i] ?? 0
    if (a > b) return false
    if (a < b) return true
  }
  return false
}

/**
 * 断言运行时版本满足最低要求；失败时抛出中文、可操作错误。
 * @param {{nodeVersion?: string, sqliteVersion?: string}} [options]
 * @returns {{nodeVersion: string, sqliteVersion: string | undefined}}
 */
export function assertRuntime({ nodeVersion = process.versions.node, sqliteVersion } = {}) {
  if (isBelow(nodeVersion, MIN_NODE_VERSION)) {
    throw new Error(
      `Node.js 版本过低：当前 ${nodeVersion}，要求 ≥ ${MIN_NODE_VERSION}。` +
        '请升级 Node.js（例如使用 nvm 安装 24.18.0 或更高版本）后重新执行 npm install。',
    )
  }
  if (sqliteVersion !== undefined && isBelow(sqliteVersion, MIN_SQLITE_VERSION)) {
    throw new Error(
      `SQLite 版本过低：当前 ${sqliteVersion}，要求 ≥ ${MIN_SQLITE_VERSION}。` +
        'SQLite 3.7.0–3.51.2 存在 WAL checkpoint 并发损坏缺陷；请升级 better-sqlite3 后重新执行 npm install。',
    )
  }
  return { nodeVersion, sqliteVersion }
}

/** CLI 入口：打开内存库读取 sqlite_version()，断言后打印一行结果。 */
async function main() {
  try {
    const Database = loadBetterSqlite3()
    const db = new Database(':memory:')
    const row = db.prepare('SELECT sqlite_version() AS version').get()
    db.close()
    const sqliteVersion = String(row.version)
    assertRuntime({ sqliteVersion })
    process.stdout.write(`runtime ok: node ${process.versions.node} sqlite ${sqliteVersion}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`运行时检查失败：${message}\n`)
    process.exitCode = 1
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry && import.meta.url === entry) {
  await main()
}
