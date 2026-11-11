import { describe, expect, it } from 'vitest'
import { ERROR_CATALOG, failureResult, successResult, type ResultMeta } from '@ledger/core'

const META: ResultMeta = {
  requestId: 'req-0001',
  durationMs: 12,
  dryRun: false,
  actor: 'cli:test',
  transport: 'cli',
}

describe('successResult', () => {
  it('构造包含 data / version / meta 的成功信封', () => {
    const result = successResult({ data: { id: 'contract-1' }, version: 7, meta: META })
    expect(result).toEqual({ ok: true, data: { id: 'contract-1' }, version: 7, meta: META })
  })

  it('仅在提供 diff 时携带该字段', () => {
    const result = successResult({
      data: null,
      version: 1,
      meta: { ...META, dryRun: true },
      diff: { amountCents: { from: 100, to: 120 } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.diff).toEqual({ amountCents: { from: 100, to: 120 } })
    }
  })
})

describe('failureResult', () => {
  it('从错误码目录填充 retryable 与默认 hint', () => {
    const result = failureResult({ code: 'DB_BUSY', message: '数据库正忙', meta: META })
    expect(result.ok).toBe(false)
    expect(result.retryable).toBe(true)
    expect(result.hint).toBe(ERROR_CATALOG.DB_BUSY.hint)
  })

  it('允许调用方覆盖 hint 并携带 details', () => {
    const result = failureResult({
      code: 'VALIDATION_FAILED',
      message: '字段校验失败',
      meta: META,
      hint: '请修正 amountCents 后重试。',
      details: { fields: ['amountCents'] },
    })
    expect(result.retryable).toBe(false)
    expect(result.hint).toBe('请修正 amountCents 后重试。')
    expect(result.details).toEqual({ fields: ['amountCents'] })
  })

  it('失败信封不携带 version / data', () => {
    const result = failureResult({ code: 'NOT_FOUND', message: '合同不存在', meta: META })
    expect(result).not.toHaveProperty('version')
    expect(result).not.toHaveProperty('data')
  })
})
