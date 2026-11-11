import type { ErrorCode } from './error-codes.js'

/** 数据集版本号：每次成功写入事务全局递增一次。 */
export type DatasetVersion = number

/**
 * 乐观并发检查：未提供 expected 时放行；与当前版本不一致返回 STALE_WRITE。
 * @param current 当前数据集版本
 * @param expected 调用方期望版本（可选）
 * @returns 失败时返回错误码，成功返回 null
 */
export function checkExpectedVersion(
  current: DatasetVersion,
  expected: DatasetVersion | undefined,
): ErrorCode | null {
  if (expected === undefined) return null
  return expected === current ? null : 'STALE_WRITE'
}
