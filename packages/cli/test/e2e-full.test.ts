import { execSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@ledger/storage-sqlite'

/** 测试文件位于 packages/cli/test/，上溯三级得到仓库根目录。 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_PATH = 'packages/cli/dist/bin.js'

/** 一份 v2 备份 fixture（含旧版非 UUID 主键）。 */
const V2_FIXTURE = 'packages/core/test/fixtures/backup-v2.json'

/** CLI 输出信封的最小结构。 */
interface CliEnvelope {
  schema_version: number
  command: string
  ok: boolean
  data?: unknown
  code?: string
  version?: number
}

/** 一次 CLI 调用的原始结果与解析后的信封。 */
interface CliRun {
  exitCode: number | undefined
  stdout: string
  stderr: string
  envelope: CliEnvelope | null
}

beforeAll(() => {
  // 只构建 CLI 及其项目引用，避免无关包尚未完成的编译状态影响本套件。
  execSync('npx tsc -b packages/cli --pretty false', { cwd: REPO_ROOT, stdio: 'pipe' })
}, 120_000)

let dataDir = ''

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'ledger-cli-e2e-full-'))
})

afterEach(async () => {
  if (dataDir !== '') {
    await rm(dataDir, { recursive: true, force: true })
    dataDir = ''
  }
})

/**
 * 调用已构建的 CLI；统一追加 `--data <临时目录> --json`。
 * @param args 子命令与参数
 * @param input 标准输入（默认空串，避免子进程等待）
 * @returns 退出码、输出与解析后的信封
 */
async function runCli(args: readonly string[], input = ''): Promise<CliRun> {
  const result = await execa('node', [BIN_PATH, ...args, '--data', dataDir, '--json'], {
    cwd: REPO_ROOT,
    reject: false,
    input,
  })
  const stdout = result.stdout.trim()
  const envelope = stdout === '' ? null : (JSON.parse(stdout) as CliEnvelope)
  return { exitCode: result.exitCode, stdout, stderr: result.stderr, envelope }
}

/**
 * 把未知值收敛成普通对象。
 * @param value 任意值
 * @returns 普通对象
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('期望一个 JSON 对象')
  }
  return { ...value }
}

/**
 * 取出 query / describe 等信封 data 下的对象字段。
 * @param envelope 信封
 * @returns data 对象
 */
function envelopeData(envelope: CliEnvelope | null): Record<string, unknown> {
  return asRecord(envelope?.data)
}

/**
 * 取出 query 结果的行。
 * @param envelope 信封
 * @returns 行对象数组
 */
function queryRows(envelope: CliEnvelope | null): Record<string, unknown>[] {
  const rows = envelopeData(envelope)['rows']
  if (!Array.isArray(rows)) return []
  return rows.map(asRecord)
}

/** 合法合同入参；金额 100 元。 */
const CONTRACT_INPUT = JSON.stringify({
  no: 'HT-2026-001',
  direction: 'sale',
  counterparty: '测试客户',
  typeCode: 'sales',
  statusCode: 'executing',
  ownerId: null,
  amountCents: 10000,
  signDate: '2026-01-01',
  startDate: '2026-01-01',
  dueDate: '2026-12-31',
})

describe('CLI 全流程', () => {
  it('全新库写入种子，合同 + 3 笔付款派生金额与进度正确', async () => {
    const seeded = await runCli([
      'query',
      '--sql',
      'SELECT (SELECT COUNT(*) FROM dict_categories) AS categories, (SELECT COUNT(*) FROM dict_items) AS items',
    ])
    expect(seeded.exitCode).toBe(0)
    const seedRow = queryRows(seeded.envelope)[0]
    expect(seedRow?.['categories']).toBe(4)
    expect(seedRow?.['items']).toBe(17)

    const created = await runCli([
      'contract',
      'upsert',
      '--idempotency-key',
      'idem-contract-create',
      '--input',
      CONTRACT_INPUT,
    ])
    expect(created.exitCode).toBe(0)
    expect(created.envelope?.ok).toBe(true)
    const contractId = String(asRecord(envelopeData(created.envelope)['contract'])['id'])

    for (const index of [1, 2, 3]) {
      const payment = await runCli([
        'payment',
        'record',
        '--idempotency-key',
        `idem-payment-${index}`,
        '--input',
        JSON.stringify({ contractId, date: `2026-02-0${index}`, amountCents: 1000 }),
      ])
      expect(payment.exitCode).toBe(0)
      expect(payment.envelope?.ok).toBe(true)
    }

    const fetched = await runCli([
      'contract',
      'get',
      '--input',
      JSON.stringify({ id: contractId }),
    ])
    expect(fetched.exitCode).toBe(0)
    const contract = asRecord(envelopeData(fetched.envelope)['contract'])
    expect(contract['paidCents']).toBe(3000)
    expect(contract['fundingPercent']).toBe(30)
  }, 30_000)

  it('导入 v2 fixture 后合同总数为 3 且 validate 零违规', async () => {
    const imported = await runCli(['import', '--backup', V2_FIXTURE])
    expect(imported.exitCode).toBe(0)
    expect(envelopeData(imported.envelope)['contracts']).toBe(3)

    const listed = await runCli(['contract', 'list', '--input', JSON.stringify({ pageSize: 100 })])
    expect(listed.exitCode).toBe(0)
    expect(envelopeData(listed.envelope)['total']).toBe(3)

    const validation = await runCli(['validate'])
    expect(validation.exitCode).toBe(0)
    const data = envelopeData(validation.envelope)
    expect(data['ok']).toBe(true)
    expect(data['violations']).toEqual([])
  }, 30_000)

  it('export 输出数据集且不包含 apiKey / baseUrl', async () => {
    const exported = await runCli(['export'])
    expect(exported.exitCode).toBe(0)
    const json = JSON.stringify(exported.envelope?.data)
    expect(json).toContain('"contracts"')
    expect(json).not.toContain('"apiKey"')
    expect(json).not.toContain('"baseUrl"')

    const outPath = path.join(dataDir, 'nested', 'export.json')
    const written = await runCli(['export', '--out', outPath])
    expect(written.exitCode).toBe(0)
    const fileData = envelopeData(written.envelope)
    expect(String(fileData['path'])).toBe(outPath)
    const text = await readFile(outPath, 'utf8')
    expect(text).not.toContain('"apiKey"')
    expect(text).not.toContain('"baseUrl"')
  }, 30_000)

  it('query 拒绝写语句，允许 SELECT', async () => {
    const rejected = await runCli([
      'query',
      '--sql',
      "INSERT INTO meta(key, value) VALUES ('x', 'y')",
    ])
    expect(rejected.exitCode).toBe(1)
    expect(rejected.envelope?.ok).toBe(false)
    expect(rejected.envelope?.code).toBe('QUERY_REJECTED')

    const allowed = await runCli(['query', '--sql', 'SELECT count(*) AS total FROM contracts'])
    expect(allowed.exitCode).toBe(0)
    expect(queryRows(allowed.envelope)[0]?.['total']).toBe(0)
  }, 30_000)

  it('backup 生成可读且完整的一致性文件，describe 暴露 18 条命令', async () => {
    const backupDir = path.join(dataDir, 'manual-backups')
    const backup = await runCli(['backup', '--out', backupDir])
    expect(backup.exitCode).toBe(0)
    const backupPath = String(envelopeData(backup.envelope)['path'])
    const info = await stat(backupPath)
    expect(info.size).toBeGreaterThan(0)

    const db = openDatabase({ file: backupPath, readonly: true })
    try {
      expect(String(db.pragma('integrity_check', { simple: true }))).toBe('ok')
    } finally {
      db.close()
    }

    const described = await runCli(['describe'])
    expect(described.exitCode).toBe(0)
    const commands = envelopeData(described.envelope)['commands']
    expect(Array.isArray(commands)).toBe(true)
    expect(Array.isArray(commands) ? commands.length : 0).toBe(18)
    const first = asRecord(Array.isArray(commands) ? commands[0] : null)
    expect(typeof first['name']).toBe('string')
    expect(first['inputSchema']).toBeDefined()
    expect(first['outputSchema']).toBeDefined()
  }, 30_000)

  it('写命令缺少幂等键被拒绝，dry-run 不改变版本', async () => {
    const missing = await runCli(['contract', 'upsert', '--input', CONTRACT_INPUT])
    expect(missing.exitCode).toBe(1)
    expect(missing.envelope?.code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const before = await runCli([
      'query',
      '--sql',
      "SELECT value FROM meta WHERE key = 'version'",
    ])
    const beforeVersion = queryRows(before.envelope)[0]?.['value']

    const dry = await runCli([
      'contract',
      'upsert',
      '--dry-run',
      '--idempotency-key',
      'idem-dry-run',
      '--input',
      CONTRACT_INPUT,
    ])
    expect(dry.exitCode).toBe(0)
    expect(dry.envelope?.ok).toBe(true)

    const after = await runCli([
      'query',
      '--sql',
      "SELECT value FROM meta WHERE key = 'version'",
    ])
    expect(queryRows(after.envelope)[0]?.['value']).toBe(beforeVersion)

    const contracts = await runCli(['query', '--sql', 'SELECT count(*) AS total FROM contracts'])
    expect(queryRows(contracts.envelope)[0]?.['total']).toBe(0)
  }, 30_000)

  it('auth token create / rotate / list：旧令牌吊销，新令牌继承操作者与标签', async () => {
    const created = await runCli([
      'auth',
      'token',
      'create',
      '--actor',
      'agent:rotate',
      '--label',
      '轮换前',
    ])
    expect(created.exitCode).toBe(0)
    const createdData = envelopeData(created.envelope)
    const oldId = String(createdData['id'])
    expect(String(createdData['token'])).toMatch(/^ldg_/)

    const rotated = await runCli(['auth', 'token', 'rotate', '--id', oldId])
    expect(rotated.exitCode).toBe(0)
    const rotatedData = envelopeData(rotated.envelope)
    expect(rotatedData['previousId']).toBe(oldId)
    expect(rotatedData['actor']).toBe('agent:rotate')
    expect(rotatedData['label']).toBe('轮换前')
    expect(String(rotatedData['token'])).toMatch(/^ldg_/)
    expect(String(rotatedData['id'])).not.toBe(oldId)

    const listed = await runCli(['auth', 'token', 'list'])
    expect(listed.exitCode).toBe(0)
    const items = envelopeData(listed.envelope)['items']
    if (!Array.isArray(items)) throw new Error('items 应为数组')
    const oldEntry = items.map(asRecord).find((item) => item['id'] === oldId)
    expect(oldEntry?.['revokedAt']).not.toBeNull()
  }, 30_000)
})
