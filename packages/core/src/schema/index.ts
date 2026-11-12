/**
 * 领域 schema 唯一出口：按名称导出 schema 目录，并提供 JSON Schema 生成。
 * JSON Schema 使用 draft 2020-12，供 CLI/HTTP/MCP 的 describe 能力复用。
 */
import { z } from 'zod'
import { contractCreateSchema, contractSchema, contractUpdateSchema } from './contract.js'
import { deliverySchema } from './delivery.js'
import { dictCategorySchema, dictItemSchema } from './dict.js'
import { paymentSchema } from './payment.js'
import { personnelSchema } from './personnel.js'

export * from './contract.js'
export * from './delivery.js'
export * from './dict.js'
export * from './payment.js'
export * from './personnel.js'
export * from './primitives.js'

/** schema 名称 → Zod schema 的稳定目录。 */
export const schemaCatalog = {
  contractCreate: contractCreateSchema,
  contractUpdate: contractUpdateSchema,
  contract: contractSchema,
  payment: paymentSchema,
  delivery: deliverySchema,
  personnel: personnelSchema,
  dictCategory: dictCategorySchema,
  dictItem: dictItemSchema,
} satisfies Readonly<Record<string, z.ZodType>>

/** schema 目录键名。 */
export type SchemaName = keyof typeof schemaCatalog

/** 可 JSON 序列化的 JSON Schema 对象。 */
export type JsonSchemaObject = Record<string, unknown>

/**
 * 判断值是否为普通 JSON 对象（排除 null 与数组）。
 * @param value 任意值
 * @returns 是否为对象
 */
function isJsonObject(value: unknown): value is JsonSchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 断言 JSON Schema 可被 JSON.stringify 序列化（无循环引用 / BigInt 等）。
 * @param value 待检查对象
 * @param name schema 名称（用于错误信息）
 * @throws {TypeError} 无法序列化时
 */
function assertJsonSerializable(value: JsonSchemaObject, name: string): void {
  let text: string | undefined
  try {
    text = JSON.stringify(value)
  } catch {
    throw new TypeError(`schema "${name}" 无法序列化为 JSON`)
  }
  if (typeof text !== 'string') throw new TypeError(`schema "${name}" 无法序列化为 JSON`)
}

/**
 * 生成单个 schema 的 JSON Schema（draft 2020-12）。
 * @param schema Zod schema
 * @param name schema 名称（用于错误信息）
 * @returns JSON Schema 对象
 * @throws {TypeError} 生成结果不是对象或不可序列化
 */
export function toJsonSchema(schema: z.ZodType, name = 'schema'): JsonSchemaObject {
  const result: unknown = z.toJSONSchema(schema, { target: 'draft-2020-12' })
  if (!isJsonObject(result)) throw new TypeError(`schema "${name}" 生成结果不是对象`)
  assertJsonSerializable(result, name)
  return result
}

/**
 * 生成全部 schema 的 JSON Schema。
 * @returns schema 名称 → JSON Schema
 */
export function jsonSchemas(): Record<string, JsonSchemaObject> {
  const entries = Object.entries(schemaCatalog).map(
    ([name, schema]) => [name, toJsonSchema(schema, name)] as const,
  )
  return Object.fromEntries(entries)
}
