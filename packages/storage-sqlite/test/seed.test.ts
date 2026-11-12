import { afterEach, describe, expect, it } from 'vitest'
import { countTable, createTestContext, disposeContext, type TestContext } from './helpers.js'
import { seedDefaultDictionaries } from '../src/index.js'

let ctx: TestContext | undefined

afterEach(() => {
  if (ctx) disposeContext(ctx)
  ctx = undefined
})

describe('seedDefaultDictionaries', () => {
  it('首次写入 4 个分类与 17 个字典项，并写入默认设置', async () => {
    ctx = await createTestContext()
    const result = seedDefaultDictionaries(ctx.db, { now: new Date('2026-01-01T00:00:00.000Z') })
    expect(result).toEqual({ seeded: true, categories: 4, items: 17 })
    expect(countTable(ctx.db, 'dict_categories')).toBe(4)
    expect(countTable(ctx.db, 'dict_items')).toBe(17)
    const setting = ctx.db
      .prepare<[string], { value_json: string }>('SELECT value_json FROM settings WHERE key = ?')
      .get('app')
    expect(setting).toBeDefined()
    expect(JSON.parse(setting?.value_json ?? '{}').reminderDays).toBe(30)
  })

  it('重复调用不写入任何行', async () => {
    ctx = await createTestContext()
    seedDefaultDictionaries(ctx.db)
    const second = seedDefaultDictionaries(ctx.db)
    expect(second).toEqual({ seeded: false, categories: 0, items: 0 })
    expect(countTable(ctx.db, 'dict_categories')).toBe(4)
    expect(countTable(ctx.db, 'dict_items')).toBe(17)
  })
})
