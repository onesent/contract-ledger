import type { PersonnelRepository, PersonnelRow } from '@ledger/core'
import type { PersonnelRecord } from './mappers.js'
import { toPersonnelRow } from './mappers.js'
import { executeAll, executeRun, toSqliteBool, type RepoRuntime } from './runtime.js'

/** SQLite 人员档案仓储。部门名称实时取字典，不落库。 */
export class SqlitePersonnelRepository implements PersonnelRepository {
  constructor(private readonly runtime: RepoRuntime) {}

  getById(id: string): PersonnelRow | null {
    const rows = executeAll<PersonnelRecord>(
      this.runtime,
      this.runtime.kysely.selectFrom('personnel').selectAll().where('id', '=', id).limit(1),
    )
    const row = rows[0]
    if (!row) return null
    return toPersonnelRow(row, this.departmentNames().get(row.department_code) ?? '')
  }

  list(includeInactive = false): PersonnelRow[] {
    let builder = this.runtime.kysely.selectFrom('personnel').selectAll()
    if (!includeInactive) {
      builder = builder.where('active', '=', 1)
    }
    builder = builder.orderBy('code', 'asc')
    const departments = this.departmentNames()
    return executeAll<PersonnelRecord>(this.runtime, builder).map((row) =>
      toPersonnelRow(row, departments.get(row.department_code) ?? ''),
    )
  }

  insert(row: PersonnelRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely.insertInto('personnel').values({
        id: row.id,
        code: row.code,
        name: row.name,
        phone: row.phone,
        department_code: row.deptCode,
        position: row.position,
        email: row.email,
        active: toSqliteBool(row.active),
        hire_date: row.hireDate,
        note: row.note,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      }),
    )
  }

  update(row: PersonnelRow): void {
    executeRun(
      this.runtime,
      this.runtime.kysely
        .updateTable('personnel')
        .set({
          code: row.code,
          name: row.name,
          phone: row.phone,
          department_code: row.deptCode,
          position: row.position,
          email: row.email,
          active: toSqliteBool(row.active),
          hire_date: row.hireDate,
          note: row.note,
          updated_at: row.updatedAt,
        })
        .where('id', '=', row.id),
    )
  }

  delete(id: string): void {
    executeRun(this.runtime, this.runtime.kysely.deleteFrom('personnel').where('id', '=', id))
  }

  /** 部门 code → 名称映射（category='department'）。 */
  private departmentNames(): Map<string, string> {
    const rows = executeAll<{ code: string; name: string }>(
      this.runtime,
      this.runtime.kysely
        .selectFrom('dict_items as i')
        .innerJoin('dict_categories as c', 'c.id', 'i.category_id')
        .select(['i.code', 'i.name'])
        .where('c.code', '=', 'department'),
    )
    return new Map(rows.map((row) => [row.code, row.name]))
  }
}
