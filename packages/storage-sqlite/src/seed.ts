import { randomUUID } from 'node:crypto'
import type { Database } from './db.js'

/** 默认字典分类与项；与旧版 DICT_CATEGORY_TEMPLATES 保持一致。 */
const DEFAULT_CATEGORIES = [
  {
    code: 'contractType',
    name: '合同类型',
    items: [
      { code: 'sales', name: '销售合同', color: '#409EFF' },
      { code: 'service', name: '服务合同', color: '#67C23A' },
      { code: 'purchase', name: '采购合同', color: '#E6A23C' },
      { code: 'framework', name: '框架协议', color: '#909399' },
    ],
  },
  {
    code: 'contractStatus',
    name: '合同状态',
    items: [
      { code: 'draft', name: '草稿', color: '#909399', builtin: true },
      { code: 'executing', name: '执行中', color: '#409EFF', builtin: true },
      { code: 'finished', name: '已完结', color: '#67C23A', builtin: true },
      { code: 'terminated', name: '已终止', color: '#F56C6C', builtin: true },
      { code: 'overdue', name: '逾期', color: '#E6A23C', builtin: true },
    ],
  },
  {
    code: 'payMethod',
    name: '付款方式',
    items: [
      { code: 'transfer', name: '银行转账', color: '#409EFF' },
      { code: 'cash', name: '现金', color: '#67C23A' },
      { code: 'check', name: '支票', color: '#E6A23C' },
      { code: 'installments', name: '分期付款', color: '#909399' },
    ],
  },
  {
    code: 'department',
    name: '部门',
    items: [
      { code: 'sales', name: '销售部', color: '#409EFF' },
      { code: 'delivery', name: '交付部', color: '#67C23A' },
      { code: 'finance', name: '财务部', color: '#E6A23C' },
      { code: 'admin', name: '行政部', color: '#909399' },
    ],
  },
] as const

/** 默认设置（不含任何密钥字段）。 */
const DEFAULT_SETTINGS = {
  id: 'app',
  reminderDays: 30,
  overdueDays: 0,
  staleDays: 90,
  amountPrecision: 2,
  pageSize: 20,
  autoNo: { enabled: true, pattern: 'HT-YYYYMM-###' },
  autoBackup: { enabled: true, intervalDays: 7 },
  columnVisibility: {},
  ai: { provider: 'custom', model: '', timeout: 30, temperature: 0.3 },
}

/** 种子结果：是否首次写入、写入的分类与项数量。 */
export interface SeedResult {
  seeded: boolean
  categories: number
  items: number
}

/**
 * 首次启动写入默认字典与设置；已存在任何字典分类时整体跳过，保证幂等。
 * @param db 数据库连接
 * @param options 可注入当前时间，便于测试
 * @returns 种子结果
 */
export function seedDefaultDictionaries(
  db: Database,
  options: { now?: Date } = {},
): SeedResult {
  const existing = db
    .prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM dict_categories')
    .get()
  if ((existing?.total ?? 0) > 0) {
    return { seeded: false, categories: 0, items: 0 }
  }

  const now = (options.now ?? new Date()).toISOString()
  const insertCategory = db.prepare<[string, string, string, number, number, string, string]>(
    'INSERT INTO dict_categories (id, code, name, builtin, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insertItem = db.prepare<
    [string, string, string, string, string, number, number, number, string, string, string]
  >(
    'INSERT INTO dict_items (id, category_id, code, name, color, enabled, sort, builtin, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const insertSetting = db.prepare<[string, string, string]>(
    'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)',
  )

  let categories = 0
  let items = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const [categoryIndex, category] of DEFAULT_CATEGORIES.entries()) {
      const categoryId = randomUUID()
      insertCategory.run(categoryId, category.code, category.name, 1, categoryIndex * 10, now, now)
      categories += 1
      for (const [itemIndex, item] of category.items.entries()) {
        insertItem.run(
          randomUUID(),
          categoryId,
          item.code,
          item.name,
          item.color,
          1,
          itemIndex * 10,
          'builtin' in item && item.builtin ? 1 : 0,
          '',
          now,
          now,
        )
        items += 1
      }
    }
    insertSetting.run('app', JSON.stringify(DEFAULT_SETTINGS), now)
    db.exec('COMMIT')
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK')
    throw error
  }
  return { seeded: true, categories, items }
}
