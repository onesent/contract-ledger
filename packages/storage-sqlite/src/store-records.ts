import { randomUUID } from 'node:crypto'
import type { Transport } from '@ledger/core'
import type { Database } from './db.js'

/** 审计行（只读投影）。 */
export interface AuditRow {
  readonly id: string
  readonly at: string
  readonly actor: string
  readonly transport: string
  readonly command: string
  readonly idempotency_key: string | null
  readonly entity: string | null
  readonly entity_id: string | null
  readonly before_json: string | null
  readonly after_json: string | null
  readonly summary: string | null
}

/** 幂等表读取行。 */
export interface IdempotencyRecord {
  readonly fingerprint: string
  readonly result_json: string
  readonly version: number
}

/** 幂等键作用域。 */
export interface IdempotencyScope {
  readonly actor: string
  readonly command: string
  readonly key: string
}

/** 幂等记录写入参数。 */
export interface IdempotencyWrite {
  readonly actor: string
  readonly command: string
  readonly key: string
  readonly fingerprint: string
  readonly result: unknown
  readonly version: number
}

/** 审计写入参数。 */
export interface AuditWrite {
  readonly actor: string
  readonly transport: Transport
  readonly command: string
  readonly idempotencyKey: string
  readonly fromVersion: number
  readonly toVersion: number
}

/**
 * 读取全局数据集版本；缺失或损坏时按 0 处理。
 * @param db 数据库连接
 */
export function readDatasetVersion(db: Database): number {
  const row = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'version'").get()
  if (!row) return 0
  const parsed = Number.parseInt(row.value, 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * 读取审计行（按写入顺序，即隐式 rowid 升序）。
 * @param db 数据库连接
 */
export function auditRows(db: Database): AuditRow[] {
  return db
    .prepare<[], AuditRow>(
      `SELECT id, at, actor, transport, command, idempotency_key, entity, entity_id,
              before_json, after_json, summary
         FROM audit_log
        ORDER BY rowid ASC`,
    )
    .all()
}

/**
 * 查询幂等键；返回 null 表示首次执行。
 * @param db 数据库连接
 * @param scope (actor, command, key) 作用域
 */
export function findIdempotency(db: Database, scope: IdempotencyScope): IdempotencyRecord | null {
  const row = db
    .prepare<[string, string, string], IdempotencyRecord>(
      `SELECT fingerprint, result_json, version
         FROM idempotency_keys
        WHERE actor = ? AND command = ? AND key = ?`,
    )
    .get(scope.actor, scope.command, scope.key)
  return row ?? null
}

/** 写入新版本号（meta 行缺失时自动补齐）。 */
export function persistVersion(db: Database, next: number): void {
  db.prepare<[string], unknown>(
    `INSERT INTO meta (key, value) VALUES ('version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(next))
}

/** 记录幂等键与本次结果。 */
export function persistIdempotency(db: Database, record: IdempotencyWrite): void {
  db.prepare<[string, string, string, string, string, number, string], unknown>(
    `INSERT INTO idempotency_keys
       (actor, command, key, fingerprint, result_json, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.actor,
    record.command,
    record.key,
    record.fingerprint,
    serializeResult(record.result),
    record.version,
    new Date().toISOString(),
  )
}

/** 追加审计行；触发器不写审计，操作者上下文只在此处可得。 */
export function persistAudit(db: Database, record: AuditWrite): void {
  db.prepare<[string, string, string, string, string, string, string, string, string], unknown>(
    `INSERT INTO audit_log
       (id, at, actor, transport, command, idempotency_key, before_json, after_json, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    new Date().toISOString(),
    record.actor,
    record.transport,
    record.command,
    record.idempotencyKey,
    JSON.stringify({ version: record.fromVersion }),
    JSON.stringify({ version: record.toVersion }),
    `v${record.fromVersion}→v${record.toVersion}`,
  )
}

/**
 * 解析幂等表保存的结果。
 *
 * 该行由同一类型 T 的结果写入，读取时按相同形状还原；边界处用一次
 * 受控断言避免把 JSON 解析结果扩散为 any。
 */
export function parseStoredResult<T>(json: string): T {
  const parsed: unknown = JSON.parse(json)
  return parsed as T
}

/** 序列化写结果；void 结果统一存为 null。 */
export function serializeResult(value: unknown): string {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? 'null' : serialized
}
