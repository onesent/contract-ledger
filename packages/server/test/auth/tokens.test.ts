import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
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
  type SessionInfo,
} from '../../src/index.js'
import {
  NOW,
  createAuthTestContext,
  disposeAuthTestContext,
  type AuthTestContext,
} from '../helpers.js'

const LATER = '2026-01-02T00:00:00.000Z'

interface TokenRow {
  secret_hash: string
  last_used_at: string | null
  revoked_at: string | null
}

interface SessionRow {
  secret_hash: string
  last_seen_at: string | null
  revoked_at: string | null
}

describe('秘密与哈希工具', () => {
  it('generateSecret 默认生成 256 位 base64url 字符串', () => {
    const secret = generateSecret()
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32)
    expect(generateSecret()).not.toBe(secret)
  })

  it('hashSecret 是确定性的 SHA-256 十六进制摘要', () => {
    expect(hashSecret('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashSecret('abc')).toBe(hashSecret('abc'))
    expect(hashSecret('abc')).not.toBe(hashSecret('abd'))
  })

  it('safeEqualHex 相等返回 true、不等或长度不一致返回 false', () => {
    const hash = hashSecret('secret')
    expect(safeEqualHex(hash, hash)).toBe(true)
    expect(safeEqualHex(hash, hashSecret('other'))).toBe(false)
    expect(safeEqualHex(hash, hash.slice(0, -1))).toBe(false)
    expect(safeEqualHex('', '')).toBe(true)
  })
})

describe('agent 令牌', () => {
  let ctx: AuthTestContext

  beforeEach(async () => {
    ctx = await createAuthTestContext()
  })

  afterEach(() => {
    disposeAuthTestContext(ctx)
  })

  it('签发的令牌格式为 ldg_<16 hex>_<secret>，库中只存哈希', () => {
    const created = createAgentToken(ctx.db, { actor: 'cli', label: '笔记本', now: NOW })
    expect(created.token).toMatch(/^ldg_[0-9a-f]{16}_[A-Za-z0-9_-]+$/)
    expect(created.id).toMatch(/^[0-9a-f]{16}$/)
    expect(created.expiresAt).toBeNull()

    const row = ctx.db
      .prepare<[string], TokenRow>(
        'SELECT secret_hash, last_used_at, revoked_at FROM auth_tokens WHERE id = ?',
      )
      .get(created.id)
    expect(row).toBeDefined()
    const firstSep = created.token.indexOf('_')
    const secondSep = created.token.indexOf('_', firstSep + 1)
    const secret = created.token.slice(secondSep + 1)
    expect(row?.secret_hash).not.toBe(secret)
    expect(row?.secret_hash).toBe(hashSecret(secret))
    expect(row?.secret_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.last_used_at).toBeNull()
    expect(row?.revoked_at).toBeNull()
  })

  it('校验成功返回操作者与 tokenId，并更新 last_used_at', () => {
    const created = createAgentToken(ctx.db, { actor: 'agent:codex', now: NOW })
    const result = verifyAgentToken(ctx.db, created.token, { now: LATER })
    expect(result).toEqual({ ok: true, actor: 'agent:codex', tokenId: created.id })

    const row = ctx.db
      .prepare<[string], TokenRow>('SELECT last_used_at FROM auth_tokens WHERE id = ?')
      .get(created.id)
    expect(row?.last_used_at).toBe(LATER)
  })

  it('错误 secret、未知 id、格式错误与空令牌分别被拒绝', () => {
    const created = createAgentToken(ctx.db, { actor: 'cli', now: NOW })
    const tokenId = created.id

    expect(
      verifyAgentToken(ctx.db, `ldg_${tokenId}_${generateSecret()}`, { now: NOW }),
    ).toEqual({ ok: false, code: 'AUTH_INVALID' })
    expect(
      verifyAgentToken(ctx.db, `ldg_0000000000000000_${generateSecret()}`, { now: NOW }),
    ).toEqual({ ok: false, code: 'AUTH_INVALID' })
    expect(verifyAgentToken(ctx.db, 'not-a-token', { now: NOW })).toEqual({
      ok: false,
      code: 'AUTH_INVALID',
    })
    expect(verifyAgentToken(ctx.db, 'ldg_ZZZZZZZZZZZZZZZZ_x', { now: NOW })).toEqual({
      ok: false,
      code: 'AUTH_INVALID',
    })
    expect(verifyAgentToken(ctx.db, '   ', { now: NOW })).toEqual({
      ok: false,
      code: 'AUTH_REQUIRED',
    })
  })

  it('secret 含下划线时仍能正确解析', () => {
    const id = '0123456789abcdef'
    const secret = 'abc_def-123'
    ctx.db
      .prepare<[string, string, string, string, string]>(
        `INSERT INTO auth_tokens (id, secret_hash, actor, label, created_at)
         VALUES (?, ?, 'cli', '', ?)`,
      )
      .run(id, hashSecret(secret), NOW)
    expect(verifyAgentToken(ctx.db, `ldg_${id}_${secret}`, { now: NOW })).toEqual({
      ok: true,
      actor: 'cli',
      tokenId: id,
    })
  })

  it('已吊销令牌返回 AUTH_INVALID；重复吊销返回 false', () => {
    const created = createAgentToken(ctx.db, { actor: 'cli', now: NOW })
    expect(revokeAgentToken(ctx.db, created.id, LATER)).toBe(true)
    expect(revokeAgentToken(ctx.db, created.id, LATER)).toBe(false)
    expect(verifyAgentToken(ctx.db, created.token, { now: LATER })).toEqual({
      ok: false,
      code: 'AUTH_INVALID',
    })
  })

  it('过期令牌返回 AUTH_INVALID', () => {
    const created = createAgentToken(ctx.db, {
      actor: 'cli',
      expiresAt: '2026-01-01T01:00:00.000Z',
      now: NOW,
    })
    expect(verifyAgentToken(ctx.db, created.token, { now: '2026-01-01T01:00:00.000Z' })).toEqual({
      ok: false,
      code: 'AUTH_INVALID',
    })
    expect(verifyAgentToken(ctx.db, created.token, { now: '2026-01-01T00:59:59.999Z' })).toEqual({
      ok: true,
      actor: 'cli',
      tokenId: created.id,
    })
  })

  it('列表不返回哈希，并可按操作者过滤', () => {
    const first = createAgentToken(ctx.db, { actor: 'alice', label: 'A', now: NOW })
    const second = createAgentToken(ctx.db, { actor: 'bob', label: 'B', now: LATER })

    const all = listAgentTokens(ctx.db)
    expect(all).toHaveLength(2)
    expect(all.map((item) => item.id).sort()).toEqual([first.id, second.id].sort())
    for (const item of all) {
      expect(Object.keys(item).sort()).toEqual([
        'actor',
        'createdAt',
        'expiresAt',
        'id',
        'label',
        'lastUsedAt',
        'revokedAt',
      ])
      expect('secretHash' in item).toBe(false)
      expect('secret_hash' in item).toBe(false)
    }

    verifyAgentToken(ctx.db, first.token, { now: LATER })
    const alice = listAgentTokens(ctx.db, 'alice')
    expect(alice).toHaveLength(1)
    expect(alice[0]?.id).toBe(first.id)
    expect(alice[0]?.label).toBe('A')
    expect(alice[0]?.lastUsedAt).toBe(LATER)
    expect(alice[0]?.expiresAt).toBeNull()
    expect(alice[0]?.revokedAt).toBeNull()
  })
})

describe('浏览器会话', () => {
  let ctx: AuthTestContext

  beforeEach(async () => {
    ctx = await createAuthTestContext()
  })

  afterEach(() => {
    disposeAuthTestContext(ctx)
  })

  it('创建会话返回一次性 secret，库中只存哈希与到期时间', () => {
    const created = createSession(ctx.db, {
      actor: 'browser',
      ttlMs: 1000,
      userAgent: 'test-agent',
      now: NOW,
    })
    expect(created.id).toMatch(/^[0-9a-f]{32}$/)
    expect(created.secret).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(created.expiresAt).toBe('2026-01-01T00:00:01.000Z')

    const row = ctx.db
      .prepare<[string], SessionRow & { user_agent: string }>(
        'SELECT secret_hash, last_seen_at, revoked_at, user_agent FROM auth_sessions WHERE id = ?',
      )
      .get(created.id)
    expect(row?.secret_hash).toBe(hashSecret(created.secret))
    expect(row?.secret_hash).not.toBe(created.secret)
    expect(row?.last_seen_at).toBeNull()
    expect(row?.revoked_at).toBeNull()
    expect(row?.user_agent).toBe('test-agent')
  })

  it('校验成功返回操作者并更新 last_seen_at', () => {
    const created = createSession(ctx.db, { actor: 'browser', now: NOW })
    const credential = { id: created.id, secret: created.secret }
    expect(verifySession(ctx.db, credential, { now: LATER })).toEqual({
      ok: true,
      actor: 'browser',
    })
    const row = ctx.db
      .prepare<[string], SessionRow>('SELECT last_seen_at FROM auth_sessions WHERE id = ?')
      .get(created.id)
    expect(row?.last_seen_at).toBe(LATER)
  })

  it('错误 secret、缺失凭证与未知会话被拒绝', () => {
    const created = createSession(ctx.db, { actor: 'browser', now: NOW })
    expect(
      verifySession(ctx.db, { id: created.id, secret: generateSecret() }, { now: NOW }),
    ).toEqual({ ok: false, code: 'AUTH_INVALID' })
    expect(verifySession(ctx.db, { id: '', secret: '' }, { now: NOW })).toEqual({
      ok: false,
      code: 'AUTH_REQUIRED',
    })
    expect(
      verifySession(ctx.db, { id: 'ffffffffffffffffffffffffffffffff', secret: generateSecret() }, { now: NOW }),
    ).toEqual({ ok: false, code: 'AUTH_INVALID' })
  })

  it('过期会话返回 AUTH_INVALID', () => {
    const created = createSession(ctx.db, { actor: 'browser', ttlMs: 1000, now: NOW })
    const credential = { id: created.id, secret: created.secret }
    expect(verifySession(ctx.db, credential, { now: '2026-01-01T00:00:01.000Z' })).toEqual({
      ok: false,
      code: 'AUTH_INVALID',
    })
  })

  it('吊销单个会话后立即失效', () => {
    const created = createSession(ctx.db, { actor: 'browser', now: NOW })
    const credential = { id: created.id, secret: created.secret }
    expect(revokeSession(ctx.db, created.id, LATER)).toBe(true)
    expect(revokeSession(ctx.db, created.id, LATER)).toBe(false)
    expect(verifySession(ctx.db, credential, { now: LATER })).toEqual({
      ok: false,
      code: 'AUTH_INVALID',
    })
  })

  it('revokeAllSessions 只吊销指定操作者的会话', () => {
    const alice1 = createSession(ctx.db, { actor: 'alice', now: NOW })
    const alice2 = createSession(ctx.db, { actor: 'alice', now: LATER })
    const bob = createSession(ctx.db, { actor: 'bob', now: NOW })

    expect(revokeAllSessions(ctx.db, 'alice', LATER)).toBe(2)
    expect(
      verifySession(ctx.db, { id: alice1.id, secret: alice1.secret }, { now: LATER }),
    ).toEqual({ ok: false, code: 'AUTH_INVALID' })
    expect(
      verifySession(ctx.db, { id: alice2.id, secret: alice2.secret }, { now: LATER }),
    ).toEqual({ ok: false, code: 'AUTH_INVALID' })
    expect(verifySession(ctx.db, { id: bob.id, secret: bob.secret }, { now: LATER })).toEqual({
      ok: true,
      actor: 'bob',
    })
    expect(revokeAllSessions(ctx.db, 'alice', LATER)).toBe(0)
  })

  it('会话列表不返回哈希，并可按操作者过滤', () => {
    const alice = createSession(ctx.db, { actor: 'alice', userAgent: 'ua-1', now: NOW })
    createSession(ctx.db, { actor: 'bob', now: LATER })

    const all = listSessions(ctx.db)
    expect(all).toHaveLength(2)
    for (const item of all) {
      expect(Object.keys(item).sort()).toEqual([
        'actor',
        'createdAt',
        'expiresAt',
        'id',
        'lastSeenAt',
        'revokedAt',
        'userAgent',
      ])
      expect('secretHash' in item).toBe(false)
      expect('secret_hash' in item).toBe(false)
    }

    const aliceSessions: SessionInfo[] = listSessions(ctx.db, 'alice')
    expect(aliceSessions).toHaveLength(1)
    expect(aliceSessions[0]?.id).toBe(alice.id)
    expect(aliceSessions[0]?.userAgent).toBe('ua-1')
  })
})
