/**
 * 金额工具：元 → 整数分、半进位舍入与展示格式化。
 * 全部使用十进制字符串 + BigInt 计算，避免浮点累加误差（如 0.1 + 0.2）。
 * 约定：金额一律以整数分（cents）在领域层流转。
 */

/** 金额解析失败（空值、非数字、负数、超出安全整数范围）。 */
export class MoneyParseError extends RangeError {
  readonly code = 'INVALID_MONEY'

  constructor(message: string) {
    super(message)
    this.name = 'MoneyParseError'
  }
}

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER)
const MONEY_NOISE = /[\s,¥￥元]/g

/**
 * 把科学计数法（如 1e-7）展开为普通十进制字符串，供十进制解析使用。
 * @param input 原始字符串
 * @returns 普通十进制字符串；非科学计数法原样返回
 */
function expandExponential(input: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(input.trim())
  if (!match) return input.trim()
  const [, sign = '', intPart = '0', fracPart = '', exponentText = '0'] = match
  const exponent = Number(exponentText)
  if (!Number.isFinite(exponent)) return input.trim()
  const digits = `${intPart}${fracPart}`
  const decimalIndex = intPart.length + exponent
  if (decimalIndex <= 0) {
    return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
}

/**
 * 把十进制元字符串按半进位（third decimal digit ≥ 5 进位）转为整数分。
 * @param raw 已展开的十进制字符串
 * @returns 整数分
 * @throws {MoneyParseError} 空值、负数、非法格式或超出安全整数范围
 */
function decimalYuanToCents(raw: string): number {
  const cleaned = raw.replace(MONEY_NOISE, '')
  if (cleaned === '') throw new MoneyParseError('金额不能为空')
  if (cleaned.startsWith('-')) throw new MoneyParseError('金额不能为负数')
  const normalized = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    throw new MoneyParseError(`金额格式非法：${raw}`)
  }
  const [intRaw = '0', fracRaw = ''] = normalized.split('.')
  const intPart = intRaw === '' ? '0' : intRaw
  const firstTwo = `${fracRaw}00`.slice(0, 2)
  const thirdDigit = fracRaw.length >= 3 ? fracRaw.charAt(2) : '0'
  let cents = BigInt(`${intPart}${firstTwo}`)
  if (thirdDigit >= '5') cents += 1n
  if (cents > MAX_SAFE_CENTS) throw new MoneyParseError(`金额超出可精确表示范围：${raw}`)
  return Number(cents)
}

/**
 * 把元金额解析为整数分：支持 "1,234.5"、"¥1234"、带千分位的字符串与普通数字。
 * 第 3 位小数按半进位（0.005 → 1 分，1.005 → 101 分）。
 * @param input 元金额（字符串或数字）
 * @returns 整数分
 * @throws {MoneyParseError} 空值、NaN、Infinity、负数或非法格式
 */
export function parseYuanToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyParseError('金额必须是有限数字')
    if (input < 0) throw new MoneyParseError('金额不能为负数')
    return decimalYuanToCents(expandExponential(String(input)))
  }
  if (input.trim() === '') throw new MoneyParseError('金额不能为空')
  return decimalYuanToCents(expandExponential(input))
}

/**
 * 把元金额（数字）按半进位舍入为整数分；负数按绝对值舍入后还原符号。
 * 供需要直接处理数字入参的调用方复用。
 * @param value 元金额
 * @returns 整数分
 * @throws {MoneyParseError} 非有限数字
 */
export function roundHalfUpCents(value: number): number {
  if (!Number.isFinite(value)) throw new MoneyParseError('金额必须是有限数字')
  const absoluteCents = decimalYuanToCents(expandExponential(String(Math.abs(value))))
  return value < 0 ? -absoluteCents : absoluteCents
}

/**
 * 数字分组：1234567 → "1,234,567"。
 * @param digits 纯数字字符串
 * @returns 带千分位的字符串
 */
function groupThousands(digits: string): string {
  let grouped = ''
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ','
    grouped += digits.charAt(i)
  }
  return grouped
}

/**
 * 拆分整数分为符号、整数部分与两位小数部分。
 * @param cents 整数分
 * @returns 拆分结果
 * @throws {MoneyParseError} 非有限、非整数或超出安全整数范围
 */
function splitCents(cents: number): { negative: boolean; intPart: string; fracPart: string } {
  if (!Number.isFinite(cents)) throw new MoneyParseError('金额必须是有限数字')
  if (!Number.isSafeInteger(cents)) throw new MoneyParseError('金额必须是安全整数分')
  const digits = BigInt(Math.abs(cents)).toString().padStart(3, '0')
  return {
    negative: cents < 0,
    intPart: digits.slice(0, -2),
    fracPart: digits.slice(-2),
  }
}

/**
 * 整数分 → 无货币符号的金额字符串（固定 2 位小数，不加千分位）。
 * @param cents 整数分
 * @returns 如 "1234.50"；负数保留前导 "-"
 * @throws {MoneyParseError} 非有限、非整数或超出安全整数范围
 */
export function formatCents(cents: number): string {
  const { negative, intPart, fracPart } = splitCents(cents)
  return `${negative ? '-' : ''}${intPart}.${fracPart}`
}

/**
 * 整数分 → 展示金额（¥ + 千分位 + 2 位小数）。
 * 非有限值统一显示「—」，绝不出现 NaN / Infinity。
 * @param cents 整数分
 * @returns 如 "¥1,234.50"；非法值返回 "—"
 */
export function formatMoneyCents(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  const { negative, intPart, fracPart } = splitCents(cents)
  return `${negative ? '-' : ''}¥${groupThousands(intPart)}.${fracPart}`
}
