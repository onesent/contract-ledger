import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 从迁移后的临时数据库生成 Kysely DB 类型。
 *
 * 为什么要自己建临时库：kysely-codegen 需要一个已迁移的 SQLite 文件来内省
 * 表、视图与列可空性；直接对主库运行会在开发机上污染真实数据。
 *
 * 为什么带 overrides：
 *  1. SQLite 的 `TEXT PRIMARY KEY` 列允许 NULL，codegen 会把所有 id/key 生成为
 *     `string | null`；但领域层保证主键非空，这里显式收紧为 `string`。
 *  2. 视图列在 SQLite 元数据里全部可空；这里按视图定义收紧可空性。
 *  3. 枚举列恢复为字面量联合类型，避免仓储层再手写 narrowing。
 */

const require = createRequire(import.meta.url)
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const migrationsDir = path.join(packageRoot, 'migrations')
const outFile = path.join(packageRoot, 'src', 'generated', 'db.ts')

/** 视图列与非空主键的类型收紧规则。 */
const overrides = {
  columns: {
    'audit_log.id': 'string',
    'auth_sessions.id': 'string',
    'auth_tokens.id': 'string',
    'contract_status_logs.id': 'string',
    'contracts.id': 'string',
    'deliveries.id': 'string',
    'dict_categories.id': 'string',
    'dict_items.id': 'string',
    'payments.id': 'string',
    'personnel.id': 'string',
    'meta.key': 'string',
    'settings.key': 'string',
    'contracts.direction': "'sale' | 'purchase'",
    'deliveries.status': "'delivered' | 'accepted' | 'rejected'",
    'v_contract_full.id': 'string',
    'v_contract_full.no': 'string',
    'v_contract_full.project_name': 'string',
    'v_contract_full.direction': "'sale' | 'purchase'",
    'v_contract_full.counterparty': 'string',
    'v_contract_full.type_item_id': 'string',
    'v_contract_full.type_code': 'string',
    'v_contract_full.type_name': 'string',
    'v_contract_full.status_item_id': 'string',
    'v_contract_full.status_code': 'string',
    'v_contract_full.status_name': 'string',
    'v_contract_full.amount_cents': 'number',
    'v_contract_full.opening_paid_cents': 'number',
    'v_contract_full.paid_cents': 'number',
    'v_contract_full.unpaid_cents': 'number',
    'v_contract_full.opening_delivered_cents': 'number',
    'v_contract_full.delivered_cents': 'number',
    'v_contract_full.last_delivery_date': 'string | null',
    'v_contract_full.funding_percent': 'number | null',
    'v_contract_full.delivery_percent': 'number | null',
    'v_contract_full.execution_gap_cents': 'number',
    'v_contract_full.gap_state': "'none' | 'balanced' | 'prepaid' | 'receivable'",
    'v_contract_full.owner_id': 'string | null',
    'v_contract_full.owner_name': 'string',
    'v_contract_full.note': 'string',
    'v_contract_full.sign_date': 'string',
    'v_contract_full.start_date': 'string',
    'v_contract_full.due_date': 'string',
    'v_contract_full.status_changed_at': 'string | null',
    'v_contract_full.created_at': 'string',
    'v_contract_full.updated_at': 'string',
    'v_contract_full.attachments_json': 'string',
    'v_contract_finance.contract_id': 'string',
    'v_contract_finance.paid_cents': 'number',
    'v_contract_finance.unpaid_cents': 'number',
    'v_contract_finance.last_payment_date': 'string | null',
    'v_contract_delivery.contract_id': 'string',
    'v_contract_delivery.delivered_cents': 'number',
    'v_contract_delivery.last_delivery_date': 'string | null',
  },
}

/** 用迁移脚本建一个临时数据库。 */
function createMigratedTempDb() {
  const Database = require('better-sqlite3')
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-codegen-'))
  const file = path.join(dir, 'codegen.db')
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    db.exec(readFileSync(path.join(migrationsDir, name), 'utf8'))
  }
  db.close()
  return { dir, file }
}

const { dir, file } = createMigratedTempDb()
try {
  const codegenBin = require.resolve('kysely-codegen/dist/cli/bin.js')
  const env = {
    ...process.env,
    // kysely-codegen 以 CJS require 加载 better-sqlite3；该包由 storage-sqlite 持有。
    NODE_PATH: [path.join(packageRoot, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  }
  execFileSync(
    process.execPath,
    [
      codegenBin,
      '--dialect',
      'sqlite',
      '--url',
      file,
      '--out-file',
      outFile,
      '--log-level',
      'info',
      '--overrides',
      JSON.stringify(overrides),
    ],
    { stdio: 'inherit', env },
  )
  process.stdout.write(`已生成 ${outFile}\n`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
