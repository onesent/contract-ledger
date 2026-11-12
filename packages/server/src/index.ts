/**
 * @ledger/server 公共入口。
 * Wave 5：认证原语（agent 令牌、浏览器会话、一次性配对码）与 Hono HTTP 服务。
 */
export { createApp, SERVER_VERSION, setReadonly } from './app.js'
export { main, resolveServerOptions } from './main.js'
export type { ServerCliOptions } from './main.js'
export { DEFAULT_PORT } from './types.js'
export type {
  AppEnv,
  AppOptions,
  AppVariables,
  AuthType,
  LedgerApp,
} from './types.js'
export { registerAuthRoutes } from './routes/auth.js'
export { registerCommandRoutes } from './routes/commands.js'
export { registerDatasetRoutes } from './routes/dataset.js'
export { registerReadRoutes } from './routes/read.js'
export { createMeta, failureResponse, problemResponse } from './http/problem.js'
export type { ProblemInit } from './http/problem.js'
export { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './http/cookies.js'
export {
  AGENT_TOKEN_PREFIX,
  DEFAULT_SESSION_TTL_MS,
  createAgentToken,
  createSession,
  generateSecret,
  hashSecret,
  listAgentTokens,
  listSessions,
  revokeAgentToken,
  revokeAllSessions,
  revokeSession,
  safeEqualHex,
  verifyAgentToken,
  verifySession,
} from './auth/tokens.js'
export type {
  AgentTokenInfo,
  AgentTokenVerifyResult,
  CreateAgentTokenOptions,
  CreateSessionOptions,
  CreatedAgentToken,
  CreatedSession,
  NowInput,
  SessionCredential,
  SessionInfo,
  SessionVerifyResult,
  VerifyAgentTokenOptions,
  VerifySessionOptions,
} from './auth/tokens.js'

export {
  DEFAULT_PAIR_CODE_LENGTH,
  DEFAULT_PAIR_CODE_MAX_ATTEMPTS,
  DEFAULT_PAIR_CODE_TTL_MS,
  PAIR_CODE_ALPHABET,
  PairingCodeService,
} from './auth/pair-code.js'
export type {
  IssuedPairingCode,
  PairingCodeOptions,
  PairingCodeVerifyResult,
} from './auth/pair-code.js'
