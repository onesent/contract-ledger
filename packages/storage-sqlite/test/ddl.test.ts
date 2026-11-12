import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIN_SQLITE_VERSION, compareVersions, sqliteVersion } from '../src/index.js'
import {
  contractRow,
  createTestContext,
  deliveryRow,
  disposeContext,
  paymentRow,
  readView,
  seedDicts,
  type TestContext,
} from './helpers.js'

describe('001_init.sql DDL', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
  })

  afterEach(() => {
    disposeContext(ctx)
  })

  it('迁移后完整性检查通过、外键开启、SQLite 版本达标', () => {
    expect(String(ctx.db.pragma('integrity_check', { simple: true }))).toBe('ok')
    expect(Number(ctx.db.pragma('foreign_keys', { simple: true }))).toBe(1)
    const version = sqliteVersion(ctx.db)
    expect(compareVersions(version, MIN_SQLITE_VERSION)).toBeGreaterThanOrEqual(0)
    expect(compareVersions(version, '3.51.3')).toBeGreaterThanOrEqual(0)
  })

  it('所有表、视图与触发器都存在', () => {
    const names = (type: string): string[] =>
      ctx.db
        .prepare<[string], { name: string }>(
          'SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name',
        )
        .all(type, 'sqlite_%')
        .map((row) => row.name)

    expect(names('table')).toEqual([
      'audit_log',
      'auth_sessions',
      'auth_tokens',
      'contract_status_logs',
      'contracts',
      'deliveries',
      'dict_categories',
      'dict_items',
      'idempotency_keys',
      'meta',
      'payments',
      'personnel',
      'schemaversion',
      'settings',
    ])
    expect(names('view')).toEqual(['v_contract_delivery', 'v_contract_finance', 'v_contract_full'])
    expect(names('trigger')).toEqual([
      'trg_contract_amount_guard',
      'trg_delivery_insert_budget',
      'trg_delivery_update_budget',
      'trg_payment_insert_budget',
      'trg_payment_update_budget',
    ])
  })

  it('开账余额 + 明细求和正确，rejected 不计入已交付', () => {
    seedDicts(ctx)
    ctx.contracts.insert(
      contractRow({
        id: 'contract-open',
        no: 'HT-OPEN',
        amountCents: 10000,
        openingPaidCents: 2000,
        openingDeliveredCents: 1500,
      }),
    )
    ctx.payments.insert(
      paymentRow({ id: 'pay-open', contractId: 'contract-open', amountCents: 3000, date: '2026-02-01' }),
    )
    ctx.deliveries.insert(
      deliveryRow({
        id: 'del-open',
        contractId: 'contract-open',
        amountCents: 2500,
        status: 'delivered',
        date: '2026-03-01',
      }),
    )
    // rejected 金额更大且日期更晚：若被计入，最后交付日期与已交付金额都会错误。
    ctx.deliveries.insert(
      deliveryRow({
        id: 'del-rejected',
        contractId: 'contract-open',
        amountCents: 500,
        status: 'rejected',
        date: '2026-04-01',
      }),
    )

    const view = readView(ctx, 'contract-open')
    expect(view.paid_cents).toBe(5000)
    expect(view.unpaid_cents).toBe(5000)
    expect(view.delivered_cents).toBe(4000)
    expect(view.last_delivery_date).toBe('2026-03-01')
    expect(view.funding_percent).toBe(50)
    expect(view.delivery_percent).toBe(40)
    expect(view.execution_gap_cents).toBe(1000)
    expect(view.gap_state).toBe('prepaid')
  })

  it('合同金额为 0 时两个进度为 NULL', () => {
    seedDicts(ctx)
    ctx.contracts.insert(contractRow({ id: 'contract-zero', no: 'HT-ZERO', amountCents: 0 }))
    const view = readView(ctx, 'contract-zero')
    expect(view.funding_percent).toBeNull()
    expect(view.delivery_percent).toBeNull()
    expect(view.gap_state).toBe('none')
  })

  it('全局数据集版本从 0 开始', () => {
    const row = ctx.db
      .prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'version'")
      .get()
    expect(row?.value).toBe('0')
  })
})
