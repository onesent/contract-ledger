import { parseYuanToCents } from '@ledger/core'

/** 普通 JSON 对象（排除 null 与数组）。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读取非空字符串；非字符串或空白串返回 null。 */
export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 读取字符串，缺失时返回空串。 */
export function readStringOrEmpty(value: unknown): string {
  return readString(value) ?? ''
}

/** 读取有限数字。 */
export function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 读取非负安全整数（v3 的整数分）。 */
export function readCents(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** 读取布尔值；缺失时使用默认值。 */
export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 读取数组；非数组返回空数组。 */
export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 旧版金额（元）→ 整数分；非法或负数返回 null。
 * MoneyParseError 属于可预期的记录级错误：由调用方计入 skipped。
 */
export function legacyYuanToCents(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    try {
      return parseYuanToCents(value)
    } catch {
      /* 非法金额按记录级失败处理 */
      return null
    }
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return parseYuanToCents(value)
    } catch {
      /* 非法金额按记录级失败处理 */
      return null
    }
  }
  return null
}

/** ISO 时间戳或回退值。 */
export function isoTimestamp(value: unknown, fallback: string): string {
  return readString(value) ?? fallback
}

/** 当前时间 ISO 字符串。 */
export function nowIso(now: Date): string {
  return now.toISOString()
}

/**
 * 递归剔除敏感设置：`apiKey` / `baseUrl` 在任意深度删除；
 * `enabled` 仅在 `ai` 对象内部删除（保留 autoNo/autoBackup 等业务开关）。
 * @param value 任意设置值
 * @returns 可 JSON 序列化的安全副本
 */
export function sanitizeSettingsForExport(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeNode(value, false)
  return isPlainObject(sanitized) ? sanitized : {}
}

/** 递归消毒内部实现；仅删除 `ai` 对象自身的 enabled，保留其它业务开关。 */
function sanitizeNode(value: unknown, isAiObject: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeNode(item, false))
  if (!isPlainObject(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'apiKey' || key === 'baseUrl') continue
    if (isAiObject && key === 'enabled') continue
    result[key] = sanitizeNode(child, key === 'ai')
  }
  return result
}

/** 旧版 settings.dictCategories 元信息（code → 名称 / builtin）。 */
export interface DictCategoryMeta {
  name: string
  builtin: boolean
}

/**
 * 从旧版 settings（或 v3 键值映射）读取字典分类元信息。
 * @param settings 备份 settings 值
 * @returns code → 元信息
 */
export function readDictCategoryMetadata(settings: unknown): Map<string, DictCategoryMeta> {
  const metadata = new Map<string, DictCategoryMeta>()
  if (!isPlainObject(settings)) return metadata
  const categories = settings.dictCategories
  if (!Array.isArray(categories)) return metadata
  for (const entry of categories) {
    if (!isPlainObject(entry)) continue
    const code = readString(entry.code)
    if (!code) continue
    metadata.set(code, {
      name: readString(entry.name) ?? code,
      builtin: readBoolean(entry.builtin, false),
    })
  }
  return metadata
}
