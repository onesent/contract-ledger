import { describe, expect, it } from 'vitest'
import { describeCore, ERROR_CATALOG, getErrorDefinition } from '@ledger/core'

describe('describeCore', () => {
  it('报告数据集 schema 版本 3', () => {
    expect(describeCore().schemaVersion).toBe(3)
  })

  it('每个冻结错误码恰好出现一次，且与目录完全一致', () => {
    const { errorCodes } = describeCore()
    const codes = errorCodes.map((item) => item.code)
    expect(new Set(codes)).toEqual(new Set(Object.keys(ERROR_CATALOG)))
    expect(codes.length).toBe(Object.keys(ERROR_CATALOG).length)
  })

  it('错误码条目包含 HTTP 状态、可重试性与中文修复建议', () => {
    for (const item of describeCore().errorCodes) {
      expect(item.httpStatus).toBeGreaterThan(0)
      expect(typeof item.retryable).toBe('boolean')
      expect(item.hint).toMatch(/[\u4e00-\u9fa5]/)
    }
  })

  it('包含非空 JSON Schema 列表且整体可序列化', () => {
    const description = describeCore()
    expect(description.schemas.length).toBeGreaterThan(0)
    for (const schema of description.schemas) {
      expect(schema.name.length).toBeGreaterThan(0)
      expect(Object.keys(schema.jsonSchema).length).toBeGreaterThan(0)
    }
    expect(JSON.parse(JSON.stringify(description))).toEqual(description)
  })
})

describe('getErrorDefinition', () => {
  it('返回对应的错误码定义', () => {
    const definition = getErrorDefinition('DUPLICATE_NO')
    expect(definition.httpStatus).toBe(409)
    expect(definition.retryable).toBe(false)
    expect(definition).toBe(ERROR_CATALOG.DUPLICATE_NO)
  })
})
