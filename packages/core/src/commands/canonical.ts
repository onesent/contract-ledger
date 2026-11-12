/**
 * 规范化 JSON 与入参指纹：同一逻辑内容必须得到逐字节一致的字符串。
 * 幂等表以 SHA-256(canonical JSON) 判定「同键同内容」与「同键不同内容」。
 */
import { createHash } from 'node:crypto'

/**
 * 判断值是否为普通 JSON 对象（原型为 Object.prototype 或 null）。
 * @param value 任意值
 * @returns 是否为普通对象
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * 拼接错误路径，根节点显示为 `$`。
 * @param path 当前路径
 * @returns 可读路径
 */
function pathLabel(path: string): string {
  return path === '' ? '$' : path
}

/**
 * JSON 字符串字面量；`JSON.stringify` 类型上可能返回 undefined，这里显式收敛。
 * @param value 原始字符串
 * @returns 带引号的 JSON 字符串
 */
function quote(value: string): string {
  const text = JSON.stringify(value)
  if (text === undefined) throw new TypeError('字符串无法序列化为 JSON')
  return text
}

/**
 * 数字字面量；调用方已保证为有限数字。
 * @param value 有限数字
 * @returns JSON 数字字面量
 */
function numberLiteral(value: number): string {
  const text = JSON.stringify(value === 0 ? 0 : value)
  if (text === undefined) throw new TypeError('数字无法序列化为 JSON')
  return text
}

/**
 * 递归规范化单个值。
 * @param value 任意 JSON 值
 * @param path 当前路径（用于错误消息）
 * @returns 规范化 JSON 片段
 * @throws {TypeError} 遇到 undefined / 函数 / 符号 / BigInt / 非有限数字 / 非普通对象
 */
function canonicalize(value: unknown, path: string): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return quote(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`规范化 JSON 不支持非有限数字：${pathLabel(path)}`)
    }
    // -0 与 0 在 JSON 中语义相同，统一输出 0，避免指纹漂移。
    return numberLiteral(value)
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`规范化 JSON 不支持 ${typeof value}：${pathLabel(path)}`)
  }
  if (typeof value === 'bigint') {
    throw new TypeError(`规范化 JSON 不支持 bigint：${pathLabel(path)}`)
  }
  if (Array.isArray(value)) {
    // 用下标循环而非 map：稀疏数组的空洞会按 undefined 处理并抛错。
    const items: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      items.push(canonicalize(value[index], `${path}[${index}]`))
    }
    return `[${items.join(',')}]`
  }
  if (!isPlainObject(value)) {
    // Date 等对象必须由调用方先转成 ISO 字符串，避免隐式时区/格式差异。
    throw new TypeError(`规范化 JSON 仅接受普通对象：${pathLabel(path)}`)
  }
  const keys = Object.keys(value).sort()
  const entries = keys.map(
    (key) => `${quote(key)}:${canonicalize(value[key], path === '' ? key : `${path}.${key}`)}`,
  )
  return `{${entries.join(',')}}`
}

/**
 * 生成确定性 JSON：对象键递归排序，数组保持原顺序。
 * @param value 任意普通 JSON 值
 * @returns 规范化字符串
 * @throws {TypeError} 值不可规范化（undefined / 函数 / 符号 / BigInt / NaN / Infinity / 非普通对象）
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, '')
}

/**
 * 计算入参指纹：SHA-256(canonical JSON) 的小写十六进制。
 * @param input 任意普通 JSON 值
 * @returns 64 位十六进制摘要
 * @throws {TypeError} 值不可规范化
 */
export function fingerprint(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex')
}
