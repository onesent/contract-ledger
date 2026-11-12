import { afterEach, describe, expect, it, vi } from 'vitest'
import { failureResult, successResult, type ResultMeta } from '@ledger/core'
import { printResult } from '@ledger/cli'

const META: ResultMeta = {
  requestId: 'req-cli-0001',
  durationMs: 3,
  dryRun: false,
  actor: 'cli:test',
  transport: 'cli',
}

/** 捕获一次 printResult 写到 stdout 的原始分片。 */
function captureStdout(run: () => void): string[] {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return true
  })
  try {
    run()
  } finally {
    spy.mockRestore()
  }
  return chunks
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('printResult 成功信封', () => {
  it('向 stdout 写入单行 JSON，并带 schema_version / command / ok', () => {
    const chunks = captureStdout(() => {
      printResult('describe', successResult({ data: { errorCodes: [] }, version: 0, meta: META }))
    })

    expect(chunks).toHaveLength(1)
    const line = chunks[0] ?? ''
    expect(line.endsWith('\n')).toBe(true)
    expect(line.trimEnd().includes('\n')).toBe(false)

    const envelope = JSON.parse(line) as {
      schema_version: number
      command: string
      ok: boolean
      data: unknown
      version: number
    }
    expect(envelope.schema_version).toBe(1)
    expect(envelope.command).toBe('describe')
    expect(envelope.ok).toBe(true)
    expect(envelope.version).toBe(0)
    expect(envelope.data).toEqual({ errorCodes: [] })
  })
})

describe('printResult 失败信封', () => {
  it('失败结果携带 code / hint / retryable 且 ok 为 false', () => {
    const chunks = captureStdout(() => {
      printResult('contract.get', failureResult({ code: 'NOT_FOUND', message: '合同不存在', meta: META }))
    })

    const envelope = JSON.parse(chunks[0] ?? '') as {
      schema_version: number
      command: string
      ok: boolean
      code: string
      hint: string
      retryable: boolean
    }
    expect(envelope.schema_version).toBe(1)
    expect(envelope.command).toBe('contract.get')
    expect(envelope.ok).toBe(false)
    expect(envelope.code).toBe('NOT_FOUND')
    expect(envelope.hint.length).toBeGreaterThan(0)
    expect(envelope.retryable).toBe(false)
  })
})
