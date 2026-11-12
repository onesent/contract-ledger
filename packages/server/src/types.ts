/**
 * 服务端共享类型：应用环境变量、认证主体与依赖集合。
 * 路由模块只依赖这些类型，避免与 app.ts 形成运行时循环引用。
 */
import type { Hono } from 'hono'
import type { CommandRegistry, LedgerStore } from '@ledger/core'
import type { Database } from '@ledger/storage-sqlite'
import type { PairingCodeService } from './auth/pair-code.js'

/** 认证来源：浏览器会话 Cookie 或 agent Bearer 令牌。 */
export type AuthType = 'cookie' | 'bearer'

/** Hono 请求上下文变量。 */
export interface AppVariables {
  /** 已认证操作者（会话用户名或令牌 actor）。 */
  actor: string
  /** 本次请求的认证方式。 */
  authType: AuthType
  /** Cookie 会话 id；Bearer 请求为 null。 */
  sessionId: string | null
}

/** 服务端 Hono 环境。 */
export interface AppEnv {
  Variables: AppVariables
}

/** 类型化 Hono 应用实例。 */
export type LedgerApp = Hono<AppEnv>

/** 创建服务所需的依赖与配置。 */
export interface AppOptions {
  /** 版本化存储端口。 */
  store: LedgerStore
  /** 已迁移的数据库连接（认证表、导出导入直接使用）。 */
  db: Database
  /** 命令注册表。 */
  registry: CommandRegistry
  /** 一次性配对码服务。 */
  pairing: PairingCodeService
  /** 预留主密钥；当前不参与 Cookie 签名（SameSite=Strict + CSRF 双提交）。 */
  secret?: string
  /** 监听端口，用于构造 Host / Origin 白名单。 */
  port?: number
  /** 监听地址（仅回环）。 */
  host?: string
  /** 可注入时钟（毫秒时间戳），便于测试。 */
  now?: () => number
  /** 允许的额外 Origin（精确匹配，含协议、主机与端口）。 */
  allowedOrigins?: string[]
  /** 只读模式；调用方可在运行期切换该字段。 */
  readonly?: boolean
}

/** 默认监听端口。 */
export const DEFAULT_PORT = 4517
