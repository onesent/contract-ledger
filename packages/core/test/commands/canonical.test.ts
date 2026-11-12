import { describe, expect, it } from 'vitest'
import { canonicalJson, fingerprint } from '@ledger/core'

describe('canonicalJson', () => {
  it('递归排序对象键，不受书写顺序影响', () => {
    const left = canonicalJson({ b: 1, a: { d: 4, c: 3 } })
    const right = canonicalJson({ a: { c: 3, d: 4 }, b: 1 })
    expect(left).toBe('{"a":{"c":3,"d":4},"b":1}')
    expect(right).toBe(left)
  })

  it('数组保持原顺序，嵌套数组逐层规范化', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
    expect(canonicalJson([{ b: 2, a: 1 }, [2, 1]])).toBe('[{"a":1,"b":2},[2,1]]')
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it('接受基本 JSON 值并统一 -0', () => {
    expect(canonicalJson('x')).toBe('"x"')
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson(-0)).toBe('0')
  })

  it('拒绝 undefined / 函数 / 符号 / BigInt / Date 与非普通对象', () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError)
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError)
    expect(() => canonicalJson({ a: () => 1 })).toThrow(TypeError)
    expect(() => canonicalJson({ a: Symbol('x') })).toThrow(TypeError)
    expect(() => canonicalJson({ a: 1n })).toThrow(TypeError)
    expect(() => canonicalJson({ at: new Date('2026-01-01T00:00:00.000Z') })).toThrow(TypeError)
    class Box {
      value = 1
    }
    expect(() => canonicalJson({ box: new Box() })).toThrow(TypeError)
  })

  it('拒绝 NaN 与 Infinity', () => {
    expect(() => canonicalJson({ amountCents: Number.NaN })).toThrow(TypeError)
    expect(() => canonicalJson({ amountCents: Number.POSITIVE_INFINITY })).toThrow(TypeError)
    expect(() => canonicalJson([Number.NEGATIVE_INFINITY])).toThrow(TypeError)
  })
})

describe('fingerprint', () => {
  it('键顺序不同但内容相同时得到同一指纹', () => {
    const left = fingerprint({ command: 'contract.upsert', input: { b: 2, a: 1 } })
    const right = fingerprint({ input: { a: 1, b: 2 }, command: 'contract.upsert' })
    expect(left).toBe(right)
    expect(left).toMatch(/^[0-9a-f]{64}$/)
  })

  it('内容不同时指纹不同', () => {
    expect(fingerprint({ amountCents: 100 })).not.toBe(fingerprint({ amountCents: 101 }))
  })
})
