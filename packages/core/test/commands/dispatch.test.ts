import { describe, expect, it, vi } from 'vitest'
import { dispatch, MemoryLedgerStore, type FieldIssue } from '@ledger/core'
import { CONTRACT_ID, createTestRegistry, makeContract } from './support.js'

/**
 * 创建已插入一份测试合同的内存库与注册表。
 * @returns 存储与注册表
 */
function setup(): { store: MemoryLedgerStore; registry: ReturnType<typeof createTestRegistry> } {
  const store = new MemoryLedgerStore()
  store.contracts.insert(makeContract())
  return { store, registry: createTestRegistry() }
}

describe('dispatch 只读命令', () => {
  it('成功返回数据、当前版本与元信息', async () => {
    const { store, registry } = setup()
    const result = await dispatch(
      registry,
      'contract.get',
      { id: CONTRACT_ID },
      { store, actor: 'agent:test', transport: 'cli' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ id: CONTRACT_ID, amountCents: 100000 })
    expect(result.version).toBe(0)
    expect(result.meta.actor).toBe('agent:test')
    expect(result.meta.transport).toBe('cli')
    expect(result.meta.dryRun).toBe(false)
    expect(result.meta.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('dispatch 写命令', () => {
  it('成功写入后版本递增并生成审计记录', async () => {
    const { store, registry } = setup()
    const result = await dispatch(
      registry,
      'payment.record',
      { contractId: CONTRACT_ID, date: '2026-02-01', amountCents: 2500 },
      { store, actor: 'agent:test', transport: 'mcp', idempotencyKey: 'key-write-1' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.version).toBe(1)
    expect(result.data).toMatchObject({ contractId: CONTRACT_ID, amountCents: 2500 })

    const state = store.state()
    expect(state.payments).toHaveLength(1)
    expect(state.version).toBe(1)
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toMatchObject({
      actor: 'agent:test',
      transport: 'mcp',
      command: 'payment.record',
      idempotencyKey: 'key-write-1',
      versionBefore: 0,
      versionAfter: 1,
    })
  })
})

describe('dispatch 错误映射', () => {
  it('未知命令返回 NOT_FOUND', async () => {
    const { store, registry } = setup()
    const result = await dispatch(registry, 'contract.missing', {}, { store, actor: 'a', transport: 'cli' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_FOUND')
    expect(result.retryable).toBe(false)
    expect(result.message).toContain('contract.missing')
  })

  it('入参校验失败返回 VALIDATION_FAILED 与字段路径', async () => {
    const { store, registry } = setup()
    const result = await dispatch(
      registry,
      'payment.record',
      { contractId: CONTRACT_ID, date: '2026-02-01', amountCents: -5 },
      { store, actor: 'a', transport: 'cli', idempotencyKey: 'key-invalid' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION_FAILED')
    const fields = (result.details as { fields: FieldIssue[] }).fields
    expect(fields.map((field) => field.path)).toContain('amountCents')
    expect(fields[0]?.message.length).toBeGreaterThan(0)
    expect(store.state().version).toBe(0)
  })
})

describe('dispatch 幂等键缺失', () => {
  it('缺少幂等键返回 IDEMPOTENCY_KEY_REQUIRED 且绝不调用 store.write', async () => {
    const { store, registry } = setup()
    const writeSpy = vi.spyOn(store, 'write')
    const result = await dispatch(
      registry,
      'payment.record',
      { contractId: CONTRACT_ID, date: '2026-02-01', amountCents: 1000 },
      { store, actor: 'a', transport: 'cli' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(writeSpy).not.toHaveBeenCalled()
    expect(store.state().payments).toHaveLength(0)
    expect(store.state().audits).toHaveLength(0)
    expect(store.state().version).toBe(0)
    writeSpy.mockRestore()
  })

  it('仅含空白的幂等键同样视为缺失', async () => {
    const { store, registry } = setup()
    const result = await dispatch(
      registry,
      'payment.record',
      { contractId: CONTRACT_ID, date: '2026-02-01', amountCents: 1000 },
      { store, actor: 'a', transport: 'cli', idempotencyKey: '   ' },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })
})
