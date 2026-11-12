/**
 * 命令处理器共享工具：时间/id 生成、派生视图、字典与人员校验、分页。
 * 处理器只通过 LedgerStore 端口读写，绝不直接接触存储实现。
 */
import { randomUUID } from 'node:crypto'
import type { ContractRow, ContractView, DictItemRow } from '../contracts/api-shapes.js'
import { LedgerError } from '../contracts/ledger-error.js'
import type { LedgerStore } from '../contracts/store-port.js'
import type { InvariantResult } from '../invariants.js'
import { assertOwnerActive as assertOwnerActiveResult } from '../invariants.js'
import { buildContractView } from '../queries/derive.js'

/** 当前 UTC 时间戳（ISO-8601）。 */
export function nowIso(): string {
  return new Date().toISOString()
}

/** 生成 UUID v4。 */
export function newId(): string {
  return randomUUID()
}

/**
 * 不变量失败时抛出 LedgerError，成功时静默返回。
 * @param result 不变量校验结果
 * @throws {LedgerError} 校验失败时携带稳定错误码与详情
 */
export function invariantOrThrow(result: InvariantResult): void {
  if (!result.ok) throw new LedgerError(result.code, result.message, result.details)
}

/**
 * 计算合同已付金额（分）：开账余额 + 全部资金流水合计。
 * @param store 存储端口
 * @param contract 合同行
 * @returns 已付金额（分）
 */
export function totalPaidCents(store: LedgerStore, contract: ContractRow): number {
  const rows = store.payments.listByContract(contract.id)
  const paid = rows.reduce((sum, row) => sum + row.amountCents, 0)
  return contract.openingPaidCents + paid
}

/**
 * 计算合同已交付金额（分）：开账余额 + 非驳回交付明细合计。
 * @param store 存储端口
 * @param contract 合同行
 * @returns 已交付金额（分）
 */
export function totalDeliveredCents(store: LedgerStore, contract: ContractRow): number {
  const rows = store.deliveries.listByContract(contract.id)
  const delivered = rows
    .filter((row) => row.status !== 'rejected')
    .reduce((sum, row) => sum + row.amountCents, 0)
  return contract.openingDeliveredCents + delivered
}

/**
 * 构造合同视图：开账余额 + 流水/交付行合计实时派生。
 * @param store 存储端口
 * @param contract 合同行
 * @returns 合同视图
 */
export function computeView(store: LedgerStore, contract: ContractRow): ContractView {
  const payments = store.payments.listByContract(contract.id)
  const deliveries = store.deliveries.listByContract(contract.id)
  const counted = deliveries.filter((row) => row.status !== 'rejected')
  const paidCents = payments.reduce((sum, row) => sum + row.amountCents, 0)
  const deliveredCents = counted.reduce((sum, row) => sum + row.amountCents, 0)
  const lastDeliveryDate =
    counted.length > 0
      ? counted.reduce<string | null>(
          (latest, row) => (latest === null || row.date > latest ? row.date : latest),
          null,
        )
      : (contract.lastDeliveryDate ?? null)
  return buildContractView({
    contract,
    paidCents,
    deliveredCents,
    lastDeliveryDate,
  })
}

/**
 * 按分类与编码取字典项；不存在时抛出 VALIDATION_FAILED 并给出下一步提示。
 * @param store 存储端口
 * @param categoryCode 字典分类编码
 * @param code 字典项编码
 * @returns 字典项
 * @throws {LedgerError} 字典项不存在
 */
export function requireDictItem(
  store: LedgerStore,
  categoryCode: string,
  code: string,
): DictItemRow {
  const item = store.dicts.findItem(categoryCode, code)
  if (item === null) {
    throw new LedgerError('VALIDATION_FAILED', `字典项不存在：${categoryCode}/${code}`, {
      categoryCode,
      code,
      hint: '先执行 dict.list 查询可用编码，或先用 dict.upsert 创建该字典项。',
    })
  }
  return item
}

/**
 * 校验负责人存在且在职；ownerId 为 null 时跳过。
 * @param store 存储端口
 * @param ownerId 负责人 id 或 null
 * @throws {LedgerError} 负责人不存在或已离职
 */
export function assertOwnerActive(store: LedgerStore, ownerId: string | null): void {
  if (ownerId === null) return
  const owner = store.personnel.getById(ownerId)
  if (owner === null) {
    throw new LedgerError('VALIDATION_FAILED', `负责人不存在：${ownerId}`, {
      ownerId,
      hint: '先执行 personnel.list 获取有效负责人 id。',
    })
  }
  invariantOrThrow(assertOwnerActiveResult(owner.active))
}

/**
 * 按 id 读取合同，缺失时抛出 NOT_FOUND。
 * @param store 存储端口
 * @param id 合同 id
 * @returns 合同行
 * @throws {LedgerError} 合同不存在
 */
export function requireContract(store: LedgerStore, id: string): ContractRow {
  const contract = store.contracts.getById(id)
  if (contract === null) {
    throw new LedgerError('NOT_FOUND', `合同不存在：${id}`, { id })
  }
  return contract
}

/** 分页结果。 */
export interface PageSlice<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/**
 * 内存分页：页码从 1 起，每页条数夹在 1..200。
 * @param items 全量列表
 * @param page 页码
 * @param pageSize 每页条数
 * @returns 当前页数据与总数
 */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1
  const safeSize = Number.isFinite(pageSize)
    ? Math.min(200, Math.max(1, Math.trunc(pageSize)))
    : 20
  const start = (safePage - 1) * safeSize
  return {
    items: items.slice(start, start + safeSize),
    total: items.length,
    page: safePage,
    pageSize: safeSize,
  }
}
