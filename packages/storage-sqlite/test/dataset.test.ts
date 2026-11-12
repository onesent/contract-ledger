import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ContractStatusLogRow } from '@ledger/core'
import {
  exportDataset,
  importDataset,
  type DatasetExport,
  type ImportReport,
} from '../src/index.js'
import {
  contractRow,
  countTable,
  createTestContext,
  deliveryRow,
  disposeContext,
  paymentRow,
  seedDicts,
  type TestContext,
} from './helpers.js'

const CONTRACT_PAID = 'c0000000-0000-4000-8000-000000000001'
const CONTRACT_PURCHASE = 'c0000000-0000-4000-8000-000000000002'
const CONTRACT_ZERO = 'c0000000-0000-4000-8000-000000000003'
const SETTING_NOW = '2026-11-12T10:00:00.000Z'

/** 读取 core 包冻结的旧版备份 fixture。 */
function readFixture(name: 'backup-v1.json' | 'backup-v2.json'): unknown {
  const file = fileURLToPath(new URL(`../../core/test/fixtures/${name}`, import.meta.url))
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  return parsed
}

/** 普通 JSON 对象类型守卫（测试内用于安全修改 fixture）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 合同中已付 / 已交付合计（与 ledger-persistence 的视图口径一致）。 */
function totals(ctx: TestContext): { paid: number; delivered: number } {
  const rows = ctx.contracts.list()
  return {
    paid: rows.reduce((sum, row) => sum + row.paidCents, 0),
    delivered: rows.reduce((sum, row) => sum + row.deliveredCents, 0),
  }
}

/** 断言导入报告中的集合计数。 */
function expectCounts(report: ImportReport, expected: Omit<ImportReport, 'warnings'>): void {
  expect({
    contracts: report.contracts,
    payments: report.payments,
    deliveries: report.deliveries,
    personnel: report.personnel,
    dicts: report.dicts,
    skipped: report.skipped,
  }).toEqual(expected)
}

describe('数据集导入 / 导出', () => {
  let ctx: TestContext | undefined

  afterEach(() => {
    if (ctx) disposeContext(ctx)
    ctx = undefined
  })

  it('导入 v2 fixture：计数、开账余额、方向、交付与状态日志', async () => {
    ctx = await createTestContext()
    const report = importDataset(ctx.db, readFixture('backup-v2.json'))

    expectCounts(report, {
      contracts: 3,
      payments: 4,
      deliveries: 3,
      personnel: 3,
      dicts: 13,
      skipped: 0,
    })
    expect(report.warnings).toEqual([])
    expect(countTable(ctx.db, 'contracts')).toBe(3)
    expect(countTable(ctx.db, 'payments')).toBe(4)
    expect(countTable(ctx.db, 'deliveries')).toBe(3)
    expect(countTable(ctx.db, 'personnel')).toBe(3)
    expect(countTable(ctx.db, 'dict_items')).toBe(13)
    expect(countTable(ctx.db, 'contract_status_logs')).toBe(3)

    const paid = ctx.contracts.getById(CONTRACT_PAID)
    if (!paid) throw new Error('合同应存在')
    expect(paid.openingPaidCents).toBe(48_000_000)
    expect(paid.paidCents).toBe(48_000_000)
    expect(paid.direction).toBe('sale')
    expect(paid.counterparty).toBe('星海科技有限公司')

    const purchase = ctx.contracts.getById(CONTRACT_PURCHASE)
    if (!purchase) throw new Error('合同应存在')
    expect(purchase.direction).toBe('purchase')
    expect(purchase.openingPaidCents).toBe(0)
    expect(purchase.paidCents).toBe(20_000_000)
    expect(purchase.openingDeliveredCents).toBe(3_000_000)
    expect(purchase.deliveredCents).toBe(18_000_000)
    expect(ctx.deliveries.listByContract(CONTRACT_PURCHASE)).toHaveLength(3)

    const zero = ctx.contracts.getById(CONTRACT_ZERO)
    if (!zero) throw new Error('合同应存在')
    expect(zero.amountCents).toBe(0)
    expect(zero.direction).toBe('sale')

    const logs = ctx.statusLogs.listByContract(CONTRACT_PAID)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      contractId: CONTRACT_PAID,
      fromCode: 'executing',
      toCode: 'finished',
      changedAt: '2025-08-15T02:30:00.000Z',
      actor: '系统初始化',
    })

    // ledger-persistence：已付合计 = 旧版 receivedAmount 合计，未伪造任何流水。
    expect(totals(ctx)).toEqual({ paid: 68_000_000, delivered: 18_000_000 })
  })

  it('导入 v1 fixture：方向按 typeCode 推断、交付为 0、状态日志保留', async () => {
    ctx = await createTestContext()
    const report = importDataset(ctx.db, readFixture('backup-v1.json'))

    expectCounts(report, {
      contracts: 3,
      payments: 4,
      deliveries: 0,
      personnel: 3,
      dicts: 13,
      skipped: 0,
    })
    const purchase = ctx.contracts.getById(CONTRACT_PURCHASE)
    if (!purchase) throw new Error('合同应存在')
    expect(purchase.direction).toBe('purchase')
    expect(purchase.openingDeliveredCents).toBe(0)
    expect(purchase.deliveredCents).toBe(0)
    expect(purchase.paidCents).toBe(20_000_000)

    const paid = ctx.contracts.getById(CONTRACT_PAID)
    if (!paid) throw new Error('合同应存在')
    expect(paid.direction).toBe('sale')
    expect(paid.paidCents).toBe(48_000_000)

    expect(countTable(ctx.db, 'deliveries')).toBe(0)
    expect(countTable(ctx.db, 'contract_status_logs')).toBe(3)
    expect(totals(ctx)).toEqual({ paid: 68_000_000, delivered: 0 })
  })

  it('导出 v3：schemaVersion 为 3、密钥被剔除、v3 再导入往返一致', async () => {
    ctx = await createTestContext()
    importDataset(ctx.db, readFixture('backup-v2.json'))
    ctx.db
      .prepare<[string, string, string], unknown>(
        'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)',
      )
      .run(
        'ai',
        JSON.stringify({
          enabled: true,
          provider: 'custom',
          baseUrl: 'http://sentinel.local/v1',
          apiKey: 'sk-sentinel-DO-NOT-LEAK',
          model: 'sentinel-model',
          timeout: 30,
        }),
        SETTING_NOW,
      )

    const exported: DatasetExport = exportDataset(ctx.db)
    expect(exported.app).toBe('contract-ledger')
    expect(exported.schemaVersion).toBe(3)
    expect(exported.data.contracts).toHaveLength(3)
    expect(exported.data.payments).toHaveLength(4)
    expect(exported.data.deliveries).toHaveLength(3)
    expect(exported.data.personnel).toHaveLength(3)
    expect(exported.data.dicts).toHaveLength(13)
    expect(exported.data.settings).toEqual({
      ai: { provider: 'custom', model: 'sentinel-model', timeout: 30 },
    })

    const text = JSON.stringify(exported)
    expect(text).not.toContain('sk-sentinel-DO-NOT-LEAK')
    expect(text).not.toContain('"apiKey"')
    expect(text).not.toContain('"baseUrl"')
    expect(JSON.stringify(exported.data.settings)).not.toContain('enabled')

    // v3 导出可再次导入（identity import），计数与已付/已交付合计保持一致。
    const second = await createTestContext()
    try {
      const report = importDataset(second.db, exported)
      expectCounts(report, {
        contracts: 3,
        payments: 4,
        deliveries: 3,
        personnel: 3,
        dicts: 13,
        skipped: 0,
      })
      expect(totals(second)).toEqual(totals(ctx))
    } finally {
      disposeContext(second)
    }
  })

  it('replace 清空旧业务行但保留 settings；merge 按 id upsert 不重复', async () => {
    ctx = await createTestContext()
    seedDicts(ctx)
    ctx.db
      .prepare<[string, string, string], unknown>(
        'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)',
      )
      .run('reminderDays', '30', SETTING_NOW)
    ctx.contracts.insert(contractRow({ id: 'legacy-old', no: 'HT-OLD', amountCents: 1000 }))
    ctx.payments.insert(paymentRow({ id: 'legacy-pay', contractId: 'legacy-old', amountCents: 100 }))
    ctx.statusLogs.insert({
      id: 'legacy-log',
      contractId: 'legacy-old',
      fromCode: '',
      toCode: 'draft',
      changedAt: SETTING_NOW,
      actor: 'tester',
      note: '',
    })

    importDataset(ctx.db, readFixture('backup-v2.json'))
    expect(ctx.contracts.getById('legacy-old')).toBeNull()
    expect(countTable(ctx.db, 'contracts')).toBe(3)
    expect(countTable(ctx.db, 'payments')).toBe(4)
    expect(countTable(ctx.db, 'contract_status_logs')).toBe(3)
    const reminder = ctx.db
      .prepare<[string], { value_json: string }>('SELECT value_json FROM settings WHERE key = ?')
      .get('reminderDays')
    expect(reminder?.value_json).toBe('30')

    // merge：额外插入一条业务数据，合并导入后不应被清空，且 fixture 记录按 id 更新不重复。
    const salesType = ctx.dicts.findItem('contractType', 'sales')
    const statusItem = ctx.dicts.findItem('contractStatus', 'executing')
    if (!salesType || !statusItem) throw new Error('字典应存在')
    ctx.contracts.insert(
      contractRow({
        id: 'merge-extra',
        no: 'HT-MERGE-EXTRA',
        typeItemId: salesType.id,
        statusItemId: statusItem.id,
      }),
    )

    const payload = readFixture('backup-v2.json')
    if (!isRecord(payload) || !isRecord(payload.data)) throw new Error('fixture 应为对象')
    const contracts = payload.data.contracts
    if (!Array.isArray(contracts) || !isRecord(contracts[0])) throw new Error('fixture 合同应存在')
    contracts[0].note = '合并导入已更新备注'

    const report = importDataset(ctx.db, payload, { mode: 'merge' })
    expectCounts(report, {
      contracts: 3,
      payments: 4,
      deliveries: 3,
      personnel: 3,
      dicts: 13,
      skipped: 0,
    })
    expect(ctx.contracts.getById('merge-extra')).not.toBeNull()
    expect(countTable(ctx.db, 'contracts')).toBe(4)
    expect(countTable(ctx.db, 'payments')).toBe(4)
    expect(ctx.contracts.getById(CONTRACT_PAID)?.note).toBe('合并导入已更新备注')
  })

  it('导入中途失败整体回滚：流水引用缺失合同时保留原有数据', async () => {
    ctx = await createTestContext()
    seedDicts(ctx)
    ctx.contracts.insert(contractRow({ id: 'keep-me', no: 'HT-KEEP', amountCents: 5000 }))
    ctx.payments.insert(paymentRow({ id: 'keep-pay', contractId: 'keep-me', amountCents: 500 }))
    const before = {
      contracts: countTable(ctx.db, 'contracts'),
      payments: countTable(ctx.db, 'payments'),
      dicts: countTable(ctx.db, 'dict_items'),
    }

    const broken = {
      app: 'contract-ledger',
      schemaVersion: 2,
      data: {
        contracts: [],
        payments: [
          {
            id: 'orphan-pay',
            contractId: 'missing-contract',
            amount: 10,
            date: '2026-01-01',
            createdAt: SETTING_NOW,
            updatedAt: SETTING_NOW,
          },
        ],
        deliveries: [],
        personnel: [],
        dicts: [],
        settings: {},
      },
    }

    expect(() => importDataset(ctx.db, broken)).toThrow(/不存在的合同/)
    expect(ctx.db.inTransaction).toBe(false)
    expect(ctx.contracts.getById('keep-me')).not.toBeNull()
    expect({
      contracts: countTable(ctx.db, 'contracts'),
      payments: countTable(ctx.db, 'payments'),
      dicts: countTable(ctx.db, 'dict_items'),
    }).toEqual(before)
  })

  it('状态日志仓储：按时间升序列出、删除合同级联清空', async () => {
    ctx = await createTestContext()
    seedDicts(ctx)
    ctx.contracts.insert(contractRow({ id: 'c-log', no: 'HT-LOG' }))
    ctx.contracts.insert(contractRow({ id: 'c-log-2', no: 'HT-LOG-2' }))

    const later: ContractStatusLogRow = {
      id: 'log-later',
      contractId: 'c-log',
      fromCode: 'draft',
      toCode: 'executing',
      changedAt: '2026-02-01T00:00:00.000Z',
      actor: 'tester',
      note: '后发生',
    }
    const earlier: ContractStatusLogRow = {
      id: 'log-earlier',
      contractId: 'c-log',
      fromCode: '',
      toCode: 'draft',
      changedAt: '2026-01-01T00:00:00.000Z',
      actor: 'tester',
      note: '先发生',
    }
    ctx.statusLogs.insert(later)
    ctx.statusLogs.insert(earlier)
    ctx.statusLogs.insert({ ...earlier, id: 'log-other', contractId: 'c-log-2' })

    expect(ctx.statusLogs.listByContract('c-log').map((row) => row.id)).toEqual([
      'log-earlier',
      'log-later',
    ])
    expect(ctx.statusLogs.listByContract('c-log-2')).toHaveLength(1)

    ctx.contracts.delete('c-log')
    expect(ctx.statusLogs.listByContract('c-log')).toEqual([])
    expect(ctx.statusLogs.listByContract('c-log-2')).toHaveLength(1)
  })
})
