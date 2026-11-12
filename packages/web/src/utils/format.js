import dayjs from 'dayjs'

/** @typedef {string|number|null|undefined} NumericLike */

const CREDIT_CURRENCY = 'CNY'

/** @type {Map<number, Intl.NumberFormat>} */
const currencyFormatters = new Map()
/** @type {Map<number, Intl.NumberFormat>} */
const numberFormatters = new Map()

/**
 * 判断是否为可用于计算的有限数字。
 * @param {NumericLike} value
 * @returns {boolean}
 */
export function isFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return false
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n)
}

/**
 * 将值转换为数字，非法值返回兜底值。
 * @param {NumericLike} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function toNumber(value, fallback = 0) {
  return isFiniteNumber(value) ? Number(value) : fallback
}

/**
 * 按精度四舍五入金额。
 * @param {NumericLike} value
 * @param {number} [precision]
 * @returns {number}
 */
export function roundMoney(value, precision = 2) {
  if (!isFiniteNumber(value)) return 0
  const factor = 10 ** precision
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

/**
 * @param {number} precision
 * @returns {Intl.NumberFormat}
 */
function currencyFormatter(precision) {
  if (!currencyFormatters.has(precision)) {
    currencyFormatters.set(
      precision,
      new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: CREDIT_CURRENCY,
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }),
    )
  }
  return currencyFormatters.get(precision)
}

/**
 * @param {number} precision
 * @returns {Intl.NumberFormat}
 */
function numberFormatter(precision) {
  if (!numberFormatters.has(precision)) {
    numberFormatters.set(
      precision,
      new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }),
    )
  }
  return numberFormatters.get(precision)
}

/**
 * 金额格式化：¥ + 千分位 + 指定小数位（默认 2 位）。
 * 非法 / 缺失值统一显示「—」，绝不出现 NaN / Infinity。
 * @param {NumericLike} value
 * @param {number} [precision]
 * @returns {string}
 */
export function formatMoney(value, precision = 2) {
  if (!isFiniteNumber(value)) return '—'
  const p = Number.isInteger(precision) ? Math.min(Math.max(precision, 0), 6) : 2
  return currencyFormatter(p).format(Number(value))
}

/**
 * 纯数字格式化（千分位），用于表格对齐展示。
 * @param {NumericLike} value
 * @param {number} [precision]
 * @returns {string}
 */
export function formatNumber(value, precision = 0) {
  if (!isFiniteNumber(value)) return '—'
  const p = Number.isInteger(precision) ? Math.min(Math.max(precision, 0), 6) : 0
  return numberFormatter(p).format(Number(value))
}

/**
 * 百分比格式化：入参为 0~100 的数值，null/非法显示「—」。
 * @param {NumericLike} value
 * @param {number} [precision]
 * @returns {string}
 */
export function formatPercent(value, precision = 1) {
  if (!isFiniteNumber(value)) return '—'
  const p = Number.isInteger(precision) ? Math.min(Math.max(precision, 0), 3) : 1
  return `${numberFormatter(p).format(Number(value))}%`
}

/**
 * 日期格式化：YYYY-MM-DD，非法值显示兜底。
 * @param {string|number|Date} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function formatDate(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD') : fallback
}

/**
 * 时间戳格式化：本地时区 YYYY-MM-DD HH:mm。
 * @param {string|number|Date} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function formatDateTime(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : fallback
}

/**
 * 月粒度格式化：YYYY-MM。
 * @param {string|number|Date} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function formatMonth(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM') : fallback
}

/**
 * 文件体积格式化。
 * @param {NumericLike} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (!isFiniteNumber(bytes) || Number(bytes) < 0) return '—'
  const n = Number(bytes)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * 存储容量格式化（同文件体积，但缺失时显示「未知」）。
 * @param {NumericLike} bytes
 * @returns {string}
 */
export function formatStorage(bytes) {
  if (!isFiniteNumber(bytes)) return '未知'
  return formatFileSize(bytes)
}

/**
 * 图表坐标轴使用的紧凑金额（万 / 亿）。
 * @param {NumericLike} value
 * @returns {string}
 */
export function formatCompactMoney(value) {
  if (!isFiniteNumber(value)) return '0'
  const n = Number(value)
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${roundMoney(n / 1e8, 2)} 亿`
  if (abs >= 1e4) return `${roundMoney(n / 1e4, 2)} 万`
  return formatNumber(n, 0)
}

/**
 * 生成备份文件名：合同台账备份_YYYYMMDD_HHmm.json
 * @param {Date|string|number} [date]
 * @returns {string}
 */
export function backupFileName(date = new Date()) {
  return `合同台账备份_${dayjs(date).format('YYYYMMDD_HHmm')}.json`
}

/**
 * 生成导入前快照文件名。
 * @param {Date|string|number} [date]
 * @returns {string}
 */
export function snapshotFileName(date = new Date()) {
  return `合同台账快照_${dayjs(date).format('YYYYMMDD_HHmmss')}.json`
}
