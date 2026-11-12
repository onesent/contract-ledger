import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Database } from '@ledger/storage-sqlite'

/**
 * 认证原语：agent 不透明令牌与浏览器会话。
 *
 * 设计约束（DECISIONS / design D8）：
 * - 明文秘密只在签发时返回一次，数据库仅保存 SHA-256 十六进制哈希；
 * - 令牌形如 `ldg_<tokenId>_<secret>`，tokenId 为 16 位十六进制；
 * - 比较必须走 `timingSafeEqual`，禁止 `===` 直接比较哈希；
 * - 所有时间戳为 ISO-8601 UTC 字符串，`now` 可注入以便测试。
 */

/** 单次使用的 agent 令牌前缀。 */
export const AGENT_TOKEN_PREFIX = 'ldg'

/** tokenId 的十六进制长度（randomBytes(8)）。 */
const TOKEN_ID_HEX_LENGTH = 16

/** 可注入的时间：缺省取当前时间。 */
export type NowInput = Date | number | string

/** agent 令牌签发参数。 */
export interface CreateAgentTokenOptions {
  actor: string
  label?: string
  expiresAt?: string
  now?: NowInput
}

/** agent 令牌签发结果；`token` 是唯一一次可见的明文。 */
export interface CreatedAgentToken {
  token: string
  id: string
  expiresAt: string | null
}

/** agent 令牌校验参数。 */
export interface VerifyAgentTokenOptions {
  now?: NowInput
}

/** agent 令牌校验结果。 */
export type AgentTokenVerifyResult =
  | { ok: true; actor: string; tokenId: string }
  | { ok: false; code: 'AUTH_INVALID' | 'AUTH_REQUIRED' }

/** 对外暴露的 agent 令牌元信息（永不包含哈希）。 */
export interface AgentTokenInfo {
  id: string
  actor: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

/** 浏览器会话签发参数。 */
export interface CreateSessionOptions {
  actor: string
  ttlMs?: number
  userAgent?: string
  now?: NowInput
}

/** 会话签发结果；`secret` 只返回一次。 */
export interface CreatedSession {
  id: string
  secret: string
  expiresAt: string
}

/** 会话凭证（Cookie 拆分后的 id + secret）。 */
export interface SessionCredential {
  id: string
  secret: string
}

/** 会话校验参数。 */
export interface VerifySessionOptions {
  now?: NowInput
}

/** 会话校验结果。 */
export type SessionVerifyResult =
  | { ok: true; actor: string }
  | { ok: false; code: 'AUTH_REQUIRED' | 'AUTH_INVALID' }

/** 对外暴露的会话元信息（永不包含哈希）。 */
export interface SessionInfo {
  id: string
  actor: string
  createdAt: string
  lastSeenAt: string | null
  expiresAt: string
  revokedAt: string | null
  userAgent: string
}

/** 数据库原始行：auth_tokens。 */
interface AgentTokenRow {
  id: string
  secret_hash: string
  actor: string
  label: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

/** 数据库原始行：auth_sessions。 */
interface SessionRow {
  id: string
  secret_hash: string
  actor: string
  created_at: string
  last_seen_at: string | null
  expires_at: string
  revoked_at: string | null
  user_agent: string
}

/** 默认会话有效期：7 天。 */
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 生成随机秘密（base64url 无填充）。
 * @param bytes 随机字节数，默认 32（256 位）
 * @returns base64url 字符串
 */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * 计算秘密的 SHA-256 十六进制摘要。
 * @param secret 明文秘密
 * @returns 64 位小写十六进制字符串
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/**
 * 定长时间比较两个十六进制字符串。
 * @param a 十六进制字符串
 * @param b 十六进制字符串
 * @returns 完全相等时为 true；长度不一致直接返回 false
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufferA = Buffer.from(a, 'hex')
  const bufferB = Buffer.from(b, 'hex')
  if (bufferA.length !== bufferB.length) return false
  if (bufferA.length === 0 && a.length > 0) return false
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * 解析时间参数为 Date；非法值抛出中文错误。
 * @param value 时间参数，缺省为当前时间
 * @returns 合法 Date
 */
function resolveNow(value?: NowInput): Date {
  if (value === undefined) return new Date()
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('无效的时间参数：now')
  return date
}

/**
 * 判断给定 ISO 时间戳是否已到期。
 * 非法时间戳按已到期处理（fail closed）。
 * @param expiresAt ISO 时间戳或 null（永不过期）
 * @param nowMs 当前毫秒时间戳
 * @returns 是否到期
 */
function isExpired(expiresAt: string | null, nowMs: number): boolean {
  if (expiresAt === null) return false
  const expiryMs = Date.parse(expiresAt)
  return Number.isNaN(expiryMs) || nowMs >= expiryMs
}

/**
 * 签发 agent 令牌：明文只在本函数返回值中出现一次。
 * @param db 已迁移的数据库连接
 * @param options 操作者、标签、过期时间与可注入时间
 * @returns 明文令牌、tokenId 与过期时间
 */
export function createAgentToken(
  db: Database,
  options: CreateAgentTokenOptions,
): CreatedAgentToken {
  const tokenId = randomBytes(8).toString('hex')
  const secret = generateSecret(32)
  const token = `${AGENT_TOKEN_PREFIX}_${tokenId}_${secret}`
  const nowIso = resolveNow(options.now).toISOString()
  const expiresAt = options.expiresAt ?? null
  db.prepare<[string, string, string, string, string, string | null]>(
    `INSERT INTO auth_tokens (id, secret_hash, actor, label, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(tokenId, hashSecret(secret), options.actor, options.label ?? '', nowIso, expiresAt)
  return { token, id: tokenId, expiresAt }
}

/**
 * 校验 agent bearer 令牌；成功时更新 last_used_at。
 * @param db 已迁移的数据库连接
 * @param token 明文 bearer 令牌
 * @param options 可注入时间
 * @returns 校验结果（不区分「格式错误」与「令牌不存在」，统一 AUTH_INVALID）
 */
export function verifyAgentToken(
  db: Database,
  token: string,
  options: VerifyAgentTokenOptions = {},
): AgentTokenVerifyResult {
  if (token.trim() === '') return { ok: false, code: 'AUTH_REQUIRED' }
  const firstSep = token.indexOf('_')
  const secondSep = firstSep < 0 ? -1 : token.indexOf('_', firstSep + 1)
  if (firstSep <= 0 || secondSep <= firstSep + 1) {
    return { ok: false, code: 'AUTH_INVALID' }
  }
  const prefix = token.slice(0, firstSep)
  const tokenId = token.slice(firstSep + 1, secondSep)
  const secret = token.slice(secondSep + 1)
  if (prefix !== AGENT_TOKEN_PREFIX || secret === '') {
    return { ok: false, code: 'AUTH_INVALID' }
  }
  if (!new RegExp(`^[0-9a-f]{${TOKEN_ID_HEX_LENGTH}}$`).test(tokenId)) {
    return { ok: false, code: 'AUTH_INVALID' }
  }

  const row = db
    .prepare<[string], AgentTokenRow>(
      `SELECT id, secret_hash, actor, label, created_at, last_used_at, expires_at, revoked_at
       FROM auth_tokens WHERE id = ?`,
    )
    .get(tokenId)
  if (!row) return { ok: false, code: 'AUTH_INVALID' }
  if (!safeEqualHex(row.secret_hash, hashSecret(secret))) {
    return { ok: false, code: 'AUTH_INVALID' }
  }
  const now = resolveNow(options.now)
  if (row.revoked_at !== null || isExpired(row.expires_at, now.getTime())) {
    return { ok: false, code: 'AUTH_INVALID' }
  }

  db.prepare<[string, string]>('UPDATE auth_tokens SET last_used_at = ? WHERE id = ?').run(
    now.toISOString(),
    row.id,
  )
  return { ok: true, actor: row.actor, tokenId: row.id }
}

/**
 * 吊销单个 agent 令牌。
 * @param db 已迁移的数据库连接
 * @param id tokenId
 * @param now 可注入时间
 * @returns 本次是否真的吊销（重复吊销返回 false）
 */
export function revokeAgentToken(db: Database, id: string, now?: NowInput): boolean {
  const result = db
    .prepare<[string, string]>(
      'UPDATE auth_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    )
    .run(resolveNow(now).toISOString(), id)
  return result.changes > 0
}

/**
 * 列出 agent 令牌元信息（可选按操作者过滤）；永不返回哈希。
 * @param db 已迁移的数据库连接
 * @param actor 可选操作者过滤
 * @returns 按签发时间倒序的令牌列表
 */
export function listAgentTokens(db: Database, actor?: string): AgentTokenInfo[] {
  const sql =
    `SELECT id, secret_hash, actor, label, created_at, last_used_at, expires_at, revoked_at
     FROM auth_tokens`
  const rows =
    actor === undefined
      ? db.prepare<[], AgentTokenRow>(`${sql} ORDER BY created_at DESC, id ASC`).all()
      : db
          .prepare<[string], AgentTokenRow>(
            `${sql} WHERE actor = ? ORDER BY created_at DESC, id ASC`,
          )
          .all(actor)
  return rows.map((row) => ({
    id: row.id,
    actor: row.actor,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }))
}

/**
 * 签发浏览器会话；secret 只返回一次。
 * @param db 已迁移的数据库连接
 * @param options 操作者、TTL、User-Agent 与可注入时间
 * @returns 会话 id、秘密与到期时间
 */
export function createSession(db: Database, options: CreateSessionOptions): CreatedSession {
  const id = randomBytes(16).toString('hex')
  const secret = generateSecret(32)
  const issuedAt = resolveNow(options.now)
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS
  const expiresAt = new Date(issuedAt.getTime() + ttlMs).toISOString()
  db.prepare<[string, string, string, string, string, string]>(
    `INSERT INTO auth_sessions
       (id, secret_hash, actor, created_at, last_seen_at, expires_at, revoked_at, user_agent)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)`,
  ).run(
    id,
    hashSecret(secret),
    options.actor,
    issuedAt.toISOString(),
    expiresAt,
    options.userAgent ?? '',
  )
  return { id, secret, expiresAt }
}

/**
 * 校验浏览器会话；成功时更新 last_seen_at。
 * @param db 已迁移的数据库连接
 * @param credential 会话 id 与明文 secret
 * @param options 可注入时间
 * @returns 校验结果
 */
export function verifySession(
  db: Database,
  credential: SessionCredential,
  options: VerifySessionOptions = {},
): SessionVerifyResult {
  if (credential.id.trim() === '' || credential.secret.trim() === '') {
    return { ok: false, code: 'AUTH_REQUIRED' }
  }
  const row = db
    .prepare<[string], SessionRow>(
      `SELECT id, secret_hash, actor, created_at, last_seen_at, expires_at, revoked_at, user_agent
       FROM auth_sessions WHERE id = ?`,
    )
    .get(credential.id)
  if (!row) return { ok: false, code: 'AUTH_INVALID' }
  if (!safeEqualHex(row.secret_hash, hashSecret(credential.secret))) {
    return { ok: false, code: 'AUTH_INVALID' }
  }
  const now = resolveNow(options.now)
  if (row.revoked_at !== null || isExpired(row.expires_at, now.getTime())) {
    return { ok: false, code: 'AUTH_INVALID' }
  }

  db.prepare<[string, string]>('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(
    now.toISOString(),
    row.id,
  )
  return { ok: true, actor: row.actor }
}

/**
 * 吊销单个会话。
 * @param db 已迁移的数据库连接
 * @param id 会话 id
 * @param now 可注入时间
 * @returns 本次是否真的吊销
 */
export function revokeSession(db: Database, id: string, now?: NowInput): boolean {
  const result = db
    .prepare<[string, string]>(
      'UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    )
    .run(resolveNow(now).toISOString(), id)
  return result.changes > 0
}

/**
 * 吊销某操作者的全部会话。
 * @param db 已迁移的数据库连接
 * @param actor 操作者
 * @param now 可注入时间
 * @returns 被吊销的会话数量
 */
export function revokeAllSessions(db: Database, actor: string, now?: NowInput): number {
  const result = db
    .prepare<[string, string]>(
      'UPDATE auth_sessions SET revoked_at = ? WHERE actor = ? AND revoked_at IS NULL',
    )
    .run(resolveNow(now).toISOString(), actor)
  return result.changes
}

/**
 * 列出会话元信息（可选按操作者过滤）；永不返回哈希。
 * @param db 已迁移的数据库连接
 * @param actor 可选操作者过滤
 * @returns 按创建时间倒序的会话列表
 */
export function listSessions(db: Database, actor?: string): SessionInfo[] {
  const sql =
    `SELECT id, secret_hash, actor, created_at, last_seen_at, expires_at, revoked_at, user_agent
     FROM auth_sessions`
  const rows =
    actor === undefined
      ? db.prepare<[], SessionRow>(`${sql} ORDER BY created_at DESC, id ASC`).all()
      : db
          .prepare<[string], SessionRow>(`${sql} WHERE actor = ? ORDER BY created_at DESC, id ASC`)
          .all(actor)
  return rows.map((row) => ({
    id: row.id,
    actor: row.actor,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    userAgent: row.user_agent,
  }))
}
