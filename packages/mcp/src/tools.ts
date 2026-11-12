/**
 * MCP 工具目录：由命令注册表生成工具定义与入参拆分规则。
 * 工具名使用 snake_case（MCP 规范不允许点号），业务入参与元参数共用同一个 inputSchema。
 */
import { z } from 'zod'
import type {
  CommandAnnotations,
  CommandRegistry,
  ErrorCode,
  JsonSchemaObject,
} from '@ledger/core'

/** 元参数名称：幂等键、期望版本与 dry-run 不进入领域命令入参。 */
export const META_ARGUMENT_NAMES = ['idempotency_key', 'expected_version', 'dry_run'] as const

/** 单个 MCP 工具定义：由一条命令派生，供 tools/list 与发现产物共同使用。 */
export interface ToolDef {
  /** MCP 工具名（snake_case）。 */
  name: string
  /** 原始点号命令名，例如 contract.upsert。 */
  commandName: string
  /** 一句话中文说明。 */
  summary: string
  /** 工具描述（当前与 summary 一致，便于宿主直接展示）。 */
  description: string
  /** 合并元参数后的入参 JSON Schema（draft 2020-12）。 */
  inputSchema: JsonSchemaObject
  /** 命令业务出参 JSON Schema（draft 2020-12）。 */
  outputSchema: JsonSchemaObject
  /** 与命令行为一致的安全注解。 */
  annotations: CommandAnnotations
  /** 该命令可能返回的稳定错误码。 */
  errorCodes: readonly ErrorCode[]
}

/** 拆分后的工具调用参数。 */
export interface SplitToolArguments {
  /** 去掉元参数后的领域入参。 */
  input: Record<string, unknown>
  /** 写命令的幂等键；只读命令通常为 undefined。 */
  idempotencyKey: string | undefined
  /** 乐观并发期望版本。 */
  expectedVersion: number | undefined
  /** 是否只预览变更。 */
  dryRun: boolean
}

/** 元参数的 JSON Schema 描述；写命令的幂等键会被并入 required。 */
const META_PROPERTY_SCHEMAS = {
  idempotency_key: {
    type: 'string',
    description: '写命令幂等键；相同键与相同入参重放首次结果，写命令缺失会被拒绝。',
  },
  expected_version: {
    type: 'integer',
    description: '期望的数据集版本；与当前版本不一致时返回 STALE_WRITE，不写入。',
  },
  dry_run: {
    type: 'boolean',
    description: '仅预览变更而不写入；成功信封中的 diff 描述将发生的变化。',
  },
} as const satisfies Record<string, JsonSchemaObject>

/**
 * 点号命令名转 MCP 工具名。
 * @param commandName 点号命令名，例如 contract.upsert
 * @returns snake_case 工具名，例如 contract_upsert
 */
export function toolName(commandName: string): string {
  return commandName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split('.')
    .join('_')
    .toLowerCase()
}

/**
 * 判断值是否为普通 JSON 对象（排除 null 与数组）。
 * @param value 任意值
 * @returns 是否为对象
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把 Zod schema 转成 JSON Schema 对象；`~standard` 等非枚举字段不会进入产物。
 * @param schema 命令入参或出参 schema
 * @returns draft 2020-12 JSON Schema
 */
function toJsonSchema(schema: z.ZodType<unknown>): JsonSchemaObject {
  const payload = z.toJSONSchema(schema, { target: 'draft-2020-12' })
  return { ...payload }
}

/**
 * 把元参数合并进单个 object schema。
 * @param base 领域入参 JSON Schema
 * @param readOnly 是否为只读命令
 * @returns 带元参数的 object schema
 */
function mergeMetaIntoObject(base: JsonSchemaObject, readOnly: boolean): JsonSchemaObject {
  const properties: Record<string, unknown> = {}
  const baseProperties = base.properties
  if (isJsonObject(baseProperties)) {
    for (const [key, value] of Object.entries(baseProperties)) {
      properties[key] = value
    }
  }
  for (const [key, value] of Object.entries(META_PROPERTY_SCHEMAS)) {
    properties[key] = value
  }

  const required: string[] = []
  const baseRequired = base.required
  if (Array.isArray(baseRequired)) {
    for (const item of baseRequired) {
      if (typeof item === 'string') required.push(item)
    }
  }
  if (!readOnly && !required.includes('idempotency_key')) {
    required.push('idempotency_key')
  }

  return { ...base, type: 'object', properties, required }
}

/**
 * 合并领域入参与 MCP 元参数，并按命令类型决定幂等键是否必填。
 * 判别联合（oneOf/anyOf）需要把元参数下沉到每个分支，否则分支的
 * additionalProperties:false 会拒绝 idempotency_key。
 * @param base 领域入参 JSON Schema
 * @param readOnly 是否为只读命令
 * @returns 带元参数的 JSON Schema
 */
function mergeMetaSchema(base: JsonSchemaObject, readOnly: boolean): JsonSchemaObject {
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const variants = base[keyword]
    if (!Array.isArray(variants)) continue
    return {
      ...base,
      [keyword]: variants.map((variant) =>
        isJsonObject(variant) ? mergeMetaSchema(variant, readOnly) : variant,
      ),
    }
  }
  return mergeMetaIntoObject(base, readOnly)
}

/**
 * 由命令注册表生成 MCP 工具定义，顺序与注册顺序一致。
 * @param registry 命令注册表
 * @returns 每个命令对应一个工具定义
 */
export function buildToolDefs(registry: CommandRegistry): ToolDef[] {
  return registry.list().map((command) => {
    const readOnly = command.annotations.readOnlyHint
    return {
      name: toolName(command.name),
      commandName: command.name,
      summary: command.summary,
      description: command.summary,
      inputSchema: mergeMetaSchema(toJsonSchema(command.input), readOnly),
      outputSchema: toJsonSchema(command.output),
      annotations: command.annotations,
      errorCodes: command.errorCodes,
    }
  })
}

/**
 * 拆分工具调用参数：删除元参数后把剩余对象交给领域分发器。
 * @param args MCP tools/call 的原始 arguments
 * @returns 领域入参与归一的元参数
 */
export function splitArguments(args: unknown): SplitToolArguments {
  const input: Record<string, unknown> = {}
  if (isJsonObject(args)) {
    for (const [key, value] of Object.entries(args)) {
      if (!(META_ARGUMENT_NAMES as readonly string[]).includes(key)) input[key] = value
    }
  }

  const idempotencyKey =
    isJsonObject(args) && typeof args.idempotency_key === 'string'
      ? args.idempotency_key
      : undefined
  const expectedVersion =
    isJsonObject(args) &&
    typeof args.expected_version === 'number' &&
    Number.isInteger(args.expected_version)
      ? args.expected_version
      : undefined
  const dryRun = isJsonObject(args) && args.dry_run === true

  return { input, idempotencyKey, expectedVersion, dryRun }
}
