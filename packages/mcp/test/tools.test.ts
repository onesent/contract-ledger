import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CommandRegistry, defineCommand } from '@ledger/core'
import { buildToolDefs, splitArguments, toolName } from '@ledger/mcp'
import { CONTRACT_ID, createTestRegistry } from './fixtures.js'

/**
 * 读取 JSON Schema 的 required 数组。
 * @param schema JSON Schema 对象
 * @returns 字符串字段名数组
 */
function requiredOf(schema: Record<string, unknown>): string[] {
  const required = schema.required
  if (!Array.isArray(required)) return []
  return required.filter((item): item is string => typeof item === 'string')
}

/**
 * 读取 JSON Schema 的 properties 映射。
 * @param schema JSON Schema 对象
 * @returns 字段名到子 schema 的映射
 */
function propertiesOf(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return {}
  }
  return { ...properties }
}

/**
 * 读取判别联合的分支数组。
 * @param schema JSON Schema 对象
 * @returns oneOf/anyOf 分支；不是联合返回空数组
 */
function variantsOf(schema: Record<string, unknown>): unknown[] {
  const oneOf = schema.oneOf
  if (Array.isArray(oneOf)) return oneOf
  const anyOf = schema.anyOf
  if (Array.isArray(anyOf)) return anyOf
  return []
}

/**
 * 把未知值收敛成普通对象。
 * @param value 任意值
 * @returns 普通对象；非对象返回 null
 */
function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return Object.fromEntries(Object.entries(value))
}

describe('toolName', () => {
  it('把点号命令名转成 snake_case', () => {
    expect(toolName('contract.upsert')).toBe('contract_upsert')
    expect(toolName('payment.record')).toBe('payment_record')
    expect(toolName('contract.statusLogs')).toBe('contract_status_logs')
    expect(toolName('describe')).toBe('describe')
  })
})

describe('buildToolDefs', () => {
  it('每条命令生成一个工具，名称使用 snake_case 且保持注册顺序', () => {
    const registry = createTestRegistry()
    const defs = buildToolDefs(registry)

    expect(defs).toHaveLength(registry.list().length)
    expect(defs.map((def) => def.name)).toEqual([
      'contract_get',
      'contract_adjust',
      'contract_remove',
    ])
    expect(defs.map((def) => def.commandName)).toEqual([
      'contract.get',
      'contract.adjust',
      'contract.remove',
    ])
  })

  it('注解与命令注册表完全一致', () => {
    const registry = createTestRegistry()
    for (const def of buildToolDefs(registry)) {
      const command = registry.get(def.commandName)
      expect(command).not.toBeNull()
      expect(def.annotations).toEqual(command?.annotations)
    }
  })

  it('写命令要求 idempotency_key，只读命令不要求', () => {
    const defs = buildToolDefs(createTestRegistry())
    const byName = new Map(defs.map((def) => [def.name, def]))

    const readRequired = requiredOf(byName.get('contract_get')?.inputSchema ?? {})
    expect(readRequired).not.toContain('idempotency_key')

    for (const name of ['contract_adjust', 'contract_remove']) {
      expect(requiredOf(byName.get(name)?.inputSchema ?? {})).toContain('idempotency_key')
    }
  })

  it('所有工具都暴露可选的 expected_version 与 dry_run，且保留领域必填字段', () => {
    const defs = buildToolDefs(createTestRegistry())
    for (const def of defs) {
      const properties = propertiesOf(def.inputSchema)
      expect(properties).toHaveProperty('idempotency_key')
      expect(properties).toHaveProperty('expected_version')
      expect(properties).toHaveProperty('dry_run')
      expect(properties).toHaveProperty('id')
      expect(requiredOf(def.inputSchema)).toContain('id')
      expect(requiredOf(def.inputSchema)).not.toContain('expected_version')
      expect(requiredOf(def.inputSchema)).not.toContain('dry_run')
    }
  })

  it('description 使用命令的中文摘要', () => {
    const registry = createTestRegistry()
    for (const def of buildToolDefs(registry)) {
      expect(def.description).toBe(registry.get(def.commandName)?.summary)
      expect(def.description.length).toBeGreaterThan(0)
    }
  })

  it('判别联合入参把元参数下沉到每个分支', () => {
    const registry = new CommandRegistry()
    registry.register(
      defineCommand({
        name: 'dict.upsert',
        summary: '新增或更新字典分类或字典项',
        input: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('category'), name: z.string() }).strict(),
          z.object({ kind: z.literal('item'), code: z.string() }).strict(),
        ]),
        output: z.object({ ok: z.boolean() }).strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        errorCodes: ['VALIDATION_FAILED'],
        handler: async () => ({ data: { ok: true } }),
      }),
    )

    const def = buildToolDefs(registry)[0]
    expect(def).toBeDefined()
    const variants = variantsOf(def?.inputSchema ?? {})
    expect(variants).toHaveLength(2)
    for (const variant of variants) {
      const schema = toRecord(variant)
      expect(schema).not.toBeNull()
      expect(requiredOf(schema ?? {})).toContain('idempotency_key')
      expect(propertiesOf(schema ?? {})).toHaveProperty('idempotency_key')
    }
  })
})

describe('splitArguments', () => {
  it('删除元参数并把剩余字段交给领域命令', () => {
    const result = splitArguments({
      id: CONTRACT_ID,
      amountCents: 120000,
      idempotency_key: 'key-1',
      expected_version: 2,
      dry_run: true,
    })

    expect(result.input).toEqual({ id: CONTRACT_ID, amountCents: 120000 })
    expect(result.idempotencyKey).toBe('key-1')
    expect(result.expectedVersion).toBe(2)
    expect(result.dryRun).toBe(true)
  })

  it('缺失元参数时返回 undefined 与 dryRun=false', () => {
    const result = splitArguments({ id: CONTRACT_ID })
    expect(result.input).toEqual({ id: CONTRACT_ID })
    expect(result.idempotencyKey).toBeUndefined()
    expect(result.expectedVersion).toBeUndefined()
    expect(result.dryRun).toBe(false)
  })

  it('拒绝非整数 expected_version，并对非对象入参返回空对象', () => {
    const nonInteger = splitArguments({ expected_version: 1.5 })
    expect(nonInteger.expectedVersion).toBeUndefined()

    const primitive = splitArguments('not-an-object')
    expect(primitive.input).toEqual({})
  })
})
