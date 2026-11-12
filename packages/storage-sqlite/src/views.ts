import type { ContractListQuery, ContractRow } from '@ledger/core'
import type { ContractViewRecord } from './repo/mappers.js'
import { toContractRow } from './repo/mappers.js'
import { executeAll, type RepoRuntime } from './repo/runtime.js'

/**
 * 合同视图读取层：直接查询 `v_contract_full`，返回带派生金额与进度的完整合同行。
 * 仓储的写操作只触碰事实表，读模型统一从这里取，保证「派生值不落库」。
 */

/**
 * 构造合同视图查询（含筛选、排序、分页）。
 * @param runtime 仓储运行时
 * @param query 过滤条件
 */
export function buildContractViewQuery(runtime: RepoRuntime, query: ContractListQuery = {}) {
  let builder = runtime.kysely.selectFrom('v_contract_full').selectAll()
  if (query.direction !== undefined) {
    builder = builder.where('direction', '=', query.direction)
  }
  if (query.statusCode !== undefined) {
    builder = builder.where('status_code', '=', query.statusCode)
  }
  if (query.ownerId !== undefined) {
    builder = builder.where('owner_id', '=', query.ownerId)
  }
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim()}%`
    builder = builder.where((eb) =>
      eb.or([eb('no', 'like', term), eb('project_name', 'like', term), eb('counterparty', 'like', term)]),
    )
  }
  builder = builder.orderBy('updated_at', 'desc').orderBy('id', 'asc')
  if (query.limit !== undefined) {
    builder = builder.limit(query.limit)
  }
  if (query.offset !== undefined) {
    builder = builder.offset(query.offset)
    if (query.limit === undefined) {
      builder = builder.limit(-1)
    }
  }
  return builder
}

/**
 * 列出合同视图行。
 * @param runtime 仓储运行时
 * @param query 过滤条件
 */
export function listContractViews(runtime: RepoRuntime, query: ContractListQuery = {}): ContractRow[] {
  return executeAll<ContractViewRecord>(runtime, buildContractViewQuery(runtime, query)).map(toContractRow)
}

/**
 * 按 id 读取单条合同视图。
 * @param runtime 仓储运行时
 * @param id 合同 id
 */
export function getContractView(runtime: RepoRuntime, id: string): ContractRow | null {
  const rows = executeAll<ContractViewRecord>(
    runtime,
    runtime.kysely.selectFrom('v_contract_full').selectAll().where('id', '=', id).limit(1),
  )
  const row = rows[0]
  return row ? toContractRow(row) : null
}
