/**
 * 8.4 性能抽查：单事务写入 1 万份合同（含字典与人员），验证方向+状态筛选走索引、
 * 列表分页与按方向统计的响应时间在本地可接受。
 */
import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoRuntime, listContractViews } from '@ledger/storage-sqlite'
import {
  createIntegrationContext,
  type IntegrationContext,
} from './helpers.js'

/** 合同总数。 */
const TOTAL = 10_000

/** 每页条数。 */
const PAGE_SIZE = 20

/** 第 500 页的偏移（1 基页码）。 */
const PAGE_OFFSET = (500 - 1) * PAGE_SIZE

/** 查询计划行。 */
interface PlanRow {
  detail: string
}

/**
 * 读取字典项 id。
 * @param ctx 集成上下文
 * @param categoryCode 分类编码
 * @param code 项编码
 * @returns 字典项 id
 */
function dictItemId(ctx: IntegrationContext, categoryCode: string, code: string): string {
  const row = ctx.db
    .prepare<[string, string], { id: string }>(
      `SELECT di.id AS id
         FROM dict_items di
         JOIN dict_categories dc ON dc.id = di.category_id
        WHERE dc.code = ? AND di.code = ?`,
    )
    .get(categoryCode, code)
  if (!row) throw new Error(`字典项不存在：${categoryCode}/${code}`)
  return row.id
}

/**
 * 生成 EXPLAIN QUERY PLAN 的 detail 列表。
 * @param ctx 集成上下文
 * @param sql 待解释的查询
 * @returns 计划详情
 */
function explain(ctx: IntegrationContext, sql: string): string[] {
  return ctx.db
    .prepare<[], PlanRow>(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((row) => row.detail)
}

/**
 * 在单事务内写入 1 万份合同与 100 名人员。
 * @param ctx 集成上下文
 */
function seedBulkData(ctx: IntegrationContext): void {
  const salesType = dictItemId(ctx, 'contractType', 'sales')
  const purchaseType = dictItemId(ctx, 'contractType', 'purchase')
  const executing = dictItemId(ctx, 'contractStatus', 'executing')
  const now = '2026-01-01T00:00:00.000Z'

  const insertPerson = ctx.db.prepare<[string, string, string, string, string], unknown>(
    'INSERT INTO personnel (id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  const insertContract = ctx.db.prepare<
    [string, string, string, string, string, string, string, number, string, string, string, string, string],
    unknown
  >(
    `INSERT INTO contracts
       (id, no, project_name, direction, counterparty, type_item_id, status_item_id,
        amount_cents, sign_date, start_date, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  ctx.db.exec('BEGIN IMMEDIATE')
  try {
    for (let index = 0; index < 100; index += 1) {
      insertPerson.run(`person-${index}`, `P-${index}`, `人员${index}`, now, now)
    }
    for (let index = 0; index < TOTAL; index += 1) {
      const isSale = index % 2 === 0
      const dueDate = `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`
      insertContract.run(
        `contract-${index}`,
        `HT-PERF-${String(index).padStart(5, '0')}`,
        `压测项目 ${index}`,
        isSale ? 'sale' : 'purchase',
        `客户 ${index % 50}`,
        isSale ? salesType : purchaseType,
        executing,
        100_000 + index,
        '2026-01-01',
        '2026-01-01',
        dueDate,
        now,
        now,
      )
    }
    ctx.db.exec('COMMIT')
  } catch (error) {
    if (ctx.db.inTransaction) ctx.db.exec('ROLLBACK')
    throw error
  }
  ctx.db.exec('ANALYZE')
}

describe('8.4 大数据量性能抽查', () => {
  let ctx: IntegrationContext

  beforeAll(async () => {
    ctx = await createIntegrationContext()
    seedBulkData(ctx)
  }, 30_000)

  afterAll(() => {
    ctx.dispose()
  })

  it('方向+状态筛选与 due_date 排序不扫 contracts 全表', () => {
    const filtered = explain(
      ctx,
      `SELECT id FROM v_contract_full
        WHERE direction = 'sale' AND status_code = 'executing'
        ORDER BY due_date ASC
        LIMIT ${PAGE_SIZE}`,
    )
    expect(filtered.some((detail) => detail.includes('idx_contracts_direction_status'))).toBe(true)
    expect(filtered.every((detail) => !detail.includes('SCAN contracts'))).toBe(true)
  })

  it(`第 500 页（每页 ${PAGE_SIZE} 条）列表查询耗时 < 500ms`, () => {
    const runtime = createRepoRuntime(ctx.db)
    // 仓储分页结果必须可用（不参与计时，避免 Kysely 编译与视图物化的首查噪声）。
    expect(listContractViews(runtime, { limit: PAGE_SIZE, offset: PAGE_OFFSET })).toHaveLength(
      PAGE_SIZE,
    )

    const sql = `SELECT id FROM v_contract_full
                  ORDER BY due_date ASC
                  LIMIT ${PAGE_SIZE} OFFSET ${PAGE_OFFSET}`
    // 预热一次，排除首次查询的编译与页缓存冷启动噪声。
    ctx.db.prepare<[], { id: string }>(sql).all()

    const startedAt = performance.now()
    const rows = ctx.db.prepare<[], { id: string }>(sql).all()
    const elapsedMs = performance.now() - startedAt

    expect(rows).toHaveLength(PAGE_SIZE)
    expect(elapsedMs).toBeLessThan(500)
  })

  it('按方向统计耗时 < 300ms 且走方向索引', () => {
    const sql = `SELECT COUNT(*) AS total, COALESCE(SUM(amount_cents), 0) AS amount
                   FROM contracts
                  WHERE direction = 'sale'`
    const plan = explain(ctx, sql)
    expect(plan.some((detail) => detail.includes('idx_contracts_direction_status'))).toBe(true)
    expect(plan.every((detail) => !detail.includes('SCAN contracts'))).toBe(true)

    const startedAt = performance.now()
    const row = ctx.db.prepare<[], { total: number; amount: number }>(sql).get()
    const elapsedMs = performance.now() - startedAt

    expect(row?.total).toBe(TOTAL / 2)
    expect(row?.amount).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(300)
  })
})
