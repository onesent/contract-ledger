/**
 * 领域不变量：纯函数，返回统一的不变量结果。
 * 错误码全部来自冻结的 ERROR_CATALOG；金额参数一律为整数分。
 */
import type { ContractDirection } from './contracts/api-shapes.js'
import type { ErrorCode } from './contracts/error-codes.js'

/** 不变量校验结果。 */
export type InvariantResult =
  | { ok: true }
  | { ok: false; code: ErrorCode; message: string; details?: unknown }

/** 合同编号条目（可用于排除自身）。 */
export interface ContractNoEntry {
  readonly id?: string
  readonly no: string
}

/**
 * 构造成功结果。
 * @returns 成功不变量结果
 */
function pass(): InvariantResult {
  return { ok: true }
}

/**
 * 构造失败结果。
 * @param code 稳定错误码
 * @param message 面向人的中文消息
 * @param details 可选结构化细节
 * @returns 失败不变量结果
 */
function fail(code: ErrorCode, message: string, details?: unknown): InvariantResult {
  if (details === undefined) return { ok: false, code, message }
  return { ok: false, code, message, details }
}

/**
 * 判断金额参数是否均为安全整数分。
 * @param values 金额列表
 * @returns 全部为安全整数时返回 true
 */
function areSafeCents(values: readonly number[]): boolean {
  return values.every((value) => Number.isSafeInteger(value))
}

/**
 * 合同编号唯一（大小写不敏感，与旧版一致）。
 * @param existing 现有合同编号（或字符串）
 * @param no 待校验编号
 * @param excludeId 更新场景需排除的合同 id
 * @returns 重复时返回 DUPLICATE_NO
 */
export function assertContractNoUnique(
  existing: ReadonlyArray<ContractNoEntry | string>,
  no: string,
  excludeId?: string,
): InvariantResult {
  const target = no.trim().toLowerCase()
  const duplicate = existing.some((entry) => {
    if (typeof entry === 'string') return entry.trim().toLowerCase() === target
    if (excludeId !== undefined && entry.id === excludeId) return false
    return entry.no.trim().toLowerCase() === target
  })
  if (duplicate) return fail('DUPLICATE_NO', `合同编号已存在：${no}`, { no })
  return pass()
}

/**
 * 负责人必须在职。
 * @param active 是否在职
 * @returns 已离职时返回 OWNER_INACTIVE
 */
export function assertOwnerActive(active: boolean): InvariantResult {
  if (active) return pass()
  return fail('OWNER_INACTIVE', '负责人已离职，请先转交或恢复在职后再提交。')
}

/**
 * 到期日不得早于开始日。
 * @param startDate 开始日期（YYYY-MM-DD）
 * @param dueDate 到期日（YYYY-MM-DD）
 * @returns 日期倒置时返回 VALIDATION_FAILED
 */
export function assertDateOrder(startDate: string, dueDate: string): InvariantResult {
  if (dueDate >= startDate) return pass()
  return fail('VALIDATION_FAILED', '到期日不能早于开始日期。', { startDate, dueDate })
}

/**
 * 合同金额不得低于已付或已交付金额。
 * @param amountCents 合同金额（分）
 * @param paidCents 已付金额（分）
 * @param deliveredCents 已交付金额（分）
 * @returns 低于已付返回 AMOUNT_BELOW_PAID，低于已交付返回 AMOUNT_BELOW_DELIVERED
 */
export function assertAmountAtLeastCommitted(
  amountCents: number,
  paidCents: number,
  deliveredCents: number,
): InvariantResult {
  if (!areSafeCents([amountCents, paidCents, deliveredCents])) {
    return fail('VALIDATION_FAILED', '金额必须为整数分。', { amountCents, paidCents, deliveredCents })
  }
  if (amountCents < paidCents) {
    return fail('AMOUNT_BELOW_PAID', '合同金额不能低于已付金额。', { amountCents, paidCents })
  }
  if (amountCents < deliveredCents) {
    return fail('AMOUNT_BELOW_DELIVERED', '合同金额不能低于已交付金额。', { amountCents, deliveredCents })
  }
  return pass()
}

/**
 * 合同已有资金或交付执行记录时，方向不可修改。
 * @param hasExecution 是否已有执行记录
 * @param current 当前方向
 * @param next 目标方向
 * @returns 方向变更被锁定时返回 CONTRACT_DIRECTION_LOCKED
 */
export function assertDirectionChangeAllowed(
  hasExecution: boolean,
  current: ContractDirection,
  next: ContractDirection,
): InvariantResult {
  if (!hasExecution || current === next) return pass()
  return fail('CONTRACT_DIRECTION_LOCKED', '合同已有付款或交付记录，方向不可修改。', {
    current,
    next,
  })
}

/**
 * 本次付款累计不得超过合同金额。
 * @param amountCents 合同金额（分）
 * @param paidCents 已付金额（分）
 * @param addCents 本次付款金额（分）
 * @returns 超付时返回 PAYMENT_EXCEEDS_CONTRACT_AMOUNT
 */
export function assertPaymentWithinContract(
  amountCents: number,
  paidCents: number,
  addCents: number,
): InvariantResult {
  if (!areSafeCents([amountCents, paidCents, addCents]) || addCents <= 0) {
    return fail('VALIDATION_FAILED', '付款金额必须为正整数分。', { amountCents, paidCents, addCents })
  }
  if (paidCents + addCents > amountCents) {
    return fail('PAYMENT_EXCEEDS_CONTRACT_AMOUNT', '本次付款超过合同剩余可付金额。', {
      amountCents,
      paidCents,
      addCents,
      remainingCents: amountCents - paidCents,
    })
  }
  return pass()
}

/**
 * 本次交付累计不得超过合同金额。
 * @param amountCents 合同金额（分）
 * @param deliveredCents 已交付金额（分）
 * @param addCents 本次交付金额（分）
 * @returns 超交付时返回 DELIVERY_EXCEEDS_CONTRACT_AMOUNT
 */
export function assertDeliveryWithinContract(
  amountCents: number,
  deliveredCents: number,
  addCents: number,
): InvariantResult {
  if (!areSafeCents([amountCents, deliveredCents, addCents]) || addCents <= 0) {
    return fail('VALIDATION_FAILED', '交付金额必须为正整数分。', { amountCents, deliveredCents, addCents })
  }
  if (deliveredCents + addCents > amountCents) {
    return fail('DELIVERY_EXCEEDS_CONTRACT_AMOUNT', '本次交付超过合同剩余可交付金额。', {
      amountCents,
      deliveredCents,
      addCents,
      remainingCents: amountCents - deliveredCents,
    })
  }
  return pass()
}
