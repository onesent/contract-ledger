/**
 * 共享 Zod 原语：业务日期、时间戳、非空字符串与十六进制颜色。
 * 日期/时间戳使用 Zod 4 的 ISO 校验器，拒绝 2 月 30 日等非法日历值。
 */
import { z } from 'zod'

/** 业务日期（YYYY-MM-DD）。 */
export const isoDate = z.iso.date()

/** ISO-8601 时间戳，允许带时区偏移（旧数据统一为 Z）。 */
export const isoDateTime = z.iso.datetime({ offset: true })

/**
 * 去除首尾空白、长度在 1..max 之间的字符串。
 * @param max 最大长度
 * @returns Zod 字符串 schema
 */
export function nonEmptyString(max: number) {
  return z.string().trim().min(1, '不能为空').max(max, `长度不能超过 ${max} 个字符`)
}

/** 十六进制颜色（#RGB 或 #RRGGBB）。 */
export const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, '颜色必须为 #RGB 或 #RRGGBB 格式')
