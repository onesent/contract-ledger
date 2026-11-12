import { describe, expect, it } from 'vitest'
import {
  formatCents,
  formatMoneyCents,
  MoneyParseError,
  parseYuanToCents,
  roundHalfUpCents,
} from '@ledger/core'

describe('parseYuanToCents', () => {
  it('第 3 位小数按半进位（0.005 → 1 分，1.005 → 101 分）', () => {
    expect(parseYuanToCents('0.005')).toBe(1)
    expect(parseYuanToCents('1.005')).toBe(101)
  })

  it('支持千分位、货币符号与数字入参', () => {
    expect(parseYuanToCents('1,234.5')).toBe(123450)
    expect(parseYuanToCents('¥1234')).toBe(123400)
    expect(parseYuanToCents('￥1,234.56')).toBe(123456)
    expect(parseYuanToCents(1234.5)).toBe(123450)
  })

  it('超过 2 位小数按第 3 位舍入', () => {
    expect(parseYuanToCents('1.239')).toBe(124)
    expect(parseYuanToCents('1.234')).toBe(123)
    expect(parseYuanToCents('0.004')).toBe(0)
  })

  it('超大金额保持精确、无浮点漂移', () => {
    expect(parseYuanToCents('1234567890123.45')).toBe(123456789012345)
  })

  it('拒绝负数、空值、NaN、Infinity 与非法格式', () => {
    expect(() => parseYuanToCents('-1')).toThrow(MoneyParseError)
    expect(() => parseYuanToCents('')).toThrow(MoneyParseError)
    expect(() => parseYuanToCents('   ')).toThrow(MoneyParseError)
    expect(() => parseYuanToCents(Number.NaN)).toThrow(MoneyParseError)
    expect(() => parseYuanToCents(Number.POSITIVE_INFINITY)).toThrow(MoneyParseError)
    expect(() => parseYuanToCents('abc')).toThrow(MoneyParseError)
    expect(() => parseYuanToCents('1.2.3')).toThrow(MoneyParseError)
  })
})

describe('roundHalfUpCents', () => {
  it('对数字入参按半进位舍入到整数分', () => {
    expect(roundHalfUpCents(1.005)).toBe(101)
    expect(roundHalfUpCents(0.004)).toBe(0)
    expect(roundHalfUpCents(1234.5)).toBe(123450)
  })
})

describe('formatCents / formatMoneyCents', () => {
  it('输出无货币符号、无千分位的两位小数金额', () => {
    expect(formatCents(123450)).toBe('1234.50')
    expect(formatCents(0)).toBe('0.00')
    expect(formatCents(-123450)).toBe('-1234.50')
    expect(formatCents(123456789012345)).toBe('1234567890123.45')
  })

  it('展示金额带 ¥ 符号与千分位', () => {
    expect(formatMoneyCents(123450)).toBe('¥1,234.50')
    expect(formatMoneyCents(123456789012345)).toBe('¥1,234,567,890,123.45')
  })

  it('仅展示辅助函数对非有限值返回「—」', () => {
    expect(formatMoneyCents(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatMoneyCents(Number.NaN)).toBe('—')
    expect(() => formatCents(Number.NaN)).toThrow(MoneyParseError)
  })
})
