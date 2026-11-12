/**
 * 认证运维命令的本地封装：agent 令牌与会话的签发、列表与吊销。
 *
 * 明文令牌只在 `createToken` 的返回值中出现一次（CLI 打印到 stdout），
 * 数据库中仅保存 SHA-256 哈希；列表命令永不返回明文或哈希。
 */
import {
  createAgentToken,
  listAgentTokens,
  listSessions,
  revokeAgentToken,
  revokeSession,
  type AgentTokenInfo,
  type CreatedAgentToken,
  type SessionInfo,
} from '@ledger/server'
import type { Database } from '@ledger/storage-sqlite'

/** agent 令牌签发参数。 */
export interface CreateTokenOptions {
  /** 令牌代表的操作者。 */
  actor: string
  /** 人类可读标签。 */
  label?: string
  /** 过期时间（ISO-8601）；缺省永不过期。 */
  expiresAt?: string
}

/** 吊销结果。 */
export interface RevokeResult {
  id: string
  revoked: boolean
}

/**
 * 签发 agent 令牌。
 * @param db 数据库连接
 * @param options 操作者、标签与过期时间
 * @returns 明文令牌（仅此一次）、tokenId 与过期时间
 */
export function createToken(db: Database, options: CreateTokenOptions): CreatedAgentToken {
  return createAgentToken(db, {
    actor: options.actor,
    label: options.label,
    expiresAt: options.expiresAt,
  })
}

/**
 * 列出 agent 令牌元信息。
 * @param db 数据库连接
 * @param actor 可选操作者过滤
 * @returns 令牌列表（不含哈希）
 */
export function listTokens(db: Database, actor?: string): AgentTokenInfo[] {
  return listAgentTokens(db, actor)
}

/**
 * 吊销一个 agent 令牌。
 * @param db 数据库连接
 * @param id tokenId
 * @returns 是否本次真正吊销
 */
export function revokeToken(db: Database, id: string): RevokeResult {
  return { id, revoked: revokeAgentToken(db, id) }
}

/**
 * 列出浏览器会话元信息。
 * @param db 数据库连接
 * @param actor 可选操作者过滤
 * @returns 会话列表（不含哈希）
 */
export function listSessionsForCli(db: Database, actor?: string): SessionInfo[] {
  return listSessions(db, actor)
}

/**
 * 吊销一个浏览器会话。
 * @param db 数据库连接
 * @param id 会话 id
 * @returns 是否本次真正吊销
 */
export function revokeSessionForCli(db: Database, id: string): RevokeResult {
  return { id, revoked: revokeSession(db, id) }
}
