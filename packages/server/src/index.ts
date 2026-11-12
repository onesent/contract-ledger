/**
 * @ledger/server 公共入口。
 * Wave 5：认证原语（agent 令牌、浏览器会话、一次性配对码）；HTTP 路由后续接入。
 */
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
