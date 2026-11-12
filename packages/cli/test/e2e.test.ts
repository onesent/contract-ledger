import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { beforeAll, describe, expect, it } from 'vitest'
import { ERROR_CATALOG } from '@ledger/core'

/** 测试文件位于 packages/cli/test/，上溯三级得到仓库根目录。 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_PATH = 'packages/cli/dist/bin.js'

interface CliEnvelope {
  schema_version: number
  command: string
  ok: boolean
  data?: {
    errorCodes?: { code: string }[]
    commands?: unknown[]
    schemas?: { name: string }[]
    schemaVersion?: number
  }
  code?: string
  hint?: string
  retryable?: boolean
}

beforeAll(() => {
  execSync('npx tsc -b --pretty false', { cwd: REPO_ROOT, stdio: 'pipe' })
}, 120_000)

describe('ledger describe', () => {
  it('--json 输出成功信封并包含完整错误码目录', async () => {
    const result = await execa('node', [BIN_PATH, 'describe', '--json'], { cwd: REPO_ROOT })
    expect(result.exitCode).toBe(0)

    const envelope = JSON.parse(result.stdout) as CliEnvelope
    expect(envelope.schema_version).toBe(1)
    expect(envelope.command).toBe('describe')
    expect(envelope.ok).toBe(true)
    expect(envelope.data?.errorCodes).toHaveLength(Object.keys(ERROR_CATALOG).length)
    expect(envelope.data?.commands).toEqual([])
    expect(envelope.data?.schemaVersion).toBe(3)
    expect(envelope.data?.schemas?.length).toBe(8)
    expect(envelope.data?.schemas?.some((entry) => entry.name === 'contractCreate')).toBe(true)
  })

  it('--schema 仅输出 JSON Schema 目录', async () => {
    const result = await execa('node', [BIN_PATH, 'describe', '--schema'], { cwd: REPO_ROOT })
    expect(result.exitCode).toBe(0)

    const schema = JSON.parse(result.stdout) as {
      $schema?: string
      definitions?: Record<string, unknown>
    }
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(Object.keys(schema.definitions ?? {})).toHaveLength(8)
    expect(schema.definitions?.contractCreate).toBeDefined()
  })

  it('--version 成功退出', async () => {
    const result = await execa('node', [BIN_PATH, '--version'], { cwd: REPO_ROOT })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('0.0.0')
  })
})

describe('用法错误', () => {
  it('未知全局选项退出码为 2 且 stderr 非空', async () => {
    const result = await execa('node', [BIN_PATH, 'describe', '--bad-flag'], {
      cwd: REPO_ROOT,
      reject: false,
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr.trim().length).toBeGreaterThan(0)
    expect(result.stdout).toBe('')
  })

  it('未知子命令退出码为 2', async () => {
    const result = await execa('node', [BIN_PATH, 'nope'], { cwd: REPO_ROOT, reject: false })
    expect(result.exitCode).toBe(2)
    expect(result.stderr.trim().length).toBeGreaterThan(0)
  })
})
