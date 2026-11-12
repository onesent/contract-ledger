import type { DictCategoryRow, DictItemRow, DictRepository } from '@ledger/core'
import type { DictCategoryRecord, DictItemRecord } from './mappers.js'
import { toDictCategoryRow, toDictItemRow } from './mappers.js'
import { executeAll, executeRun, toSqliteBool, type RepoRuntime } from './runtime.js'

/** 字典项 join 分类后的行。 */
type DictItemJoined = DictItemRecord & { category_code: string }

/** SQLite 字典仓储（分类 + 项）。 */
export class SqliteDictRepository implements DictRepository {
  constructor(private readonly runtime: RepoRuntime) {}

  listCategories(): DictCategoryRow[] {
    const rows = executeAll<DictCategoryRecord>(
      this.runtime,
      this.runtime.kysely
        .selectFrom('dict_categories')
        .selectAll()
        .orderBy('sort', 'asc')
        .orderBy('code', 'asc'),
    )
    return rows.map(toDictCategoryRow)
  }

  listItems(categoryCode?: string): DictItemRow[] {
    let builder = this.runtime.kysely
      .selectFrom('dict_items')
      .innerJoin('dict_categories', 'dict_categories.id', 'dict_items.category_id')
      .selectAll('dict_items')
      .select('dict_categories.code as category_code')
    if (categoryCode !== undefined) {
      builder = builder.where('dict_categories.code', '=', categoryCode)
    }
    builder = builder.orderBy('dict_items.sort', 'asc').orderBy('dict_items.code', 'asc')
    return executeAll<DictItemJoined>(this.runtime, builder).map((row) =>
      toDictItemRow(row, row.category_code),
    )
  }

  getItemById(id: string): DictItemRow | null {
    const rows = executeAll<DictItemJoined>(
      this.runtime,
      this.runtime.kysely
        .selectFrom('dict_items')
        .innerJoin('dict_categories', 'dict_categories.id', 'dict_items.category_id')
        .selectAll('dict_items')
        .select('dict_categories.code as category_code')
        .where('dict_items.id', '=', id)
        .limit(1),
    )
    const row = rows[0]
    return row ? toDictItemRow(row, row.category_code) : null
  }

  findItem(categoryCode: string, code: string): DictItemRow | null {
    const rows = executeAll<DictItemJoined>(
      this.runtime,
      this.runtime.kysely
        .selectFrom('dict_items')
        .innerJoin('dict_categories', 'dict_categories.id', 'dict_items.category_id')
        .selectAll('dict_items')
        .select('dict_categories.code as category_code')
        .where('dict_categories.code', '=', categoryCode)
        .where('dict_items.code', '=', code)
        .limit(1),
    )
    const row = rows[0]
    return row ? toDictItemRow(row, row.category_code) : null
  }

  insertCategory(row: DictCategoryRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely.insertInto('dict_categories').values({
        id: row.id,
        code: row.code,
        name: row.name,
        builtin: toSqliteBool(row.builtin),
        sort: row.sort,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      }),
    )
  }

  updateCategory(row: DictCategoryRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely
        .updateTable('dict_categories')
        .set({
          code: row.code,
          name: row.name,
          builtin: toSqliteBool(row.builtin),
          sort: row.sort,
          updated_at: row.updatedAt,
        })
        .where('id', '=', row.id),
    )
  }

  deleteCategory(id: string): void {
    executeRun(this.runtime, this.runtime.kysely.deleteFrom('dict_categories').where('id', '=', id))
  }

  insertItem(row: DictItemRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely.insertInto('dict_items').values({
        id: row.id,
        category_id: this.categoryId(row.categoryCode),
        code: row.code,
        name: row.name,
        color: row.color,
        enabled: toSqliteBool(row.enabled),
        sort: row.sort,
        builtin: toSqliteBool(row.builtin),
        note: row.note,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      }),
    )
  }

  updateItem(row: DictItemRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely
        .updateTable('dict_items')
        .set({
          category_id: this.categoryId(row.categoryCode),
          code: row.code,
          name: row.name,
          color: row.color,
          enabled: toSqliteBool(row.enabled),
          sort: row.sort,
          builtin: toSqliteBool(row.builtin),
          note: row.note,
          updated_at: row.updatedAt,
        })
        .where('id', '=', row.id),
    )
  }

  deleteItem(id: string): void {
    executeRun(this.runtime, this.runtime.kysely.deleteFrom('dict_items').where('id', '=', id))
  }

  /** 按分类 code 解析分类 id；不存在时报错（保持与领域层一致的显式失败）。 */
  private categoryId(categoryCode: string): string {
    const rows = executeAll<{ id: string }>(
      this.runtime,
      this.runtime.kysely
        .selectFrom('dict_categories')
        .select('id')
        .where('code', '=', categoryCode)
        .limit(1),
    )
    const row = rows[0]
    if (!row) {
      throw new Error(`字典分类不存在：${categoryCode}`)
    }
    return row.id
  }
}
