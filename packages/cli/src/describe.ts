import {
  describeCore as describeCoreCatalog,
  toJsonSchema,
  type CommandAnnotations,
  type CommandRegistry,
  type CoreDescription,
  type ErrorCode,
  type JsonSchemaObject,
} from '@ledger/core'

/** 单条命令的机器可读描述。 */
export interface CommandDescription {
  /** 点号命令名，例如 contract.upsert。 */
  name: string
  /** 一句话中文摘要。 */
  summary: string
  /** 只读/破坏性/幂等/开放世界注解。 */
  annotations: CommandAnnotations
  /** 该命令可能返回的稳定错误码。 */
  errorCodes: readonly ErrorCode[]
  /** 入参 JSON Schema（draft 2020-12）。 */
  inputSchema: JsonSchemaObject
  /** 出参 JSON Schema（draft 2020-12）。 */
  outputSchema: JsonSchemaObject
}

/** `describe --schema` 中单条命令的 schema 组。 */
export interface CommandSchemaEntry {
  input: JsonSchemaObject
  output: JsonSchemaObject
}

/**
 * 读取 core 的能力描述（错误码、JSON Schema、数据集版本）。
 * 命令层不再重复维护一份错误码目录，避免与 core 漂移。
 * @returns core 能力描述
 */
export function describeCatalog(): CoreDescription {
  return describeCoreCatalog()
}

/**
 * 从命令注册表生成命令描述列表，顺序与注册顺序一致。
 * @param registry 命令注册表
 * @returns 命令描述数组
 */
export function describeCommands(registry: CommandRegistry): CommandDescription[] {
  return registry.list().map((command) => ({
    name: command.name,
    summary: command.summary,
    annotations: command.annotations,
    errorCodes: command.errorCodes,
    inputSchema: toJsonSchema(command.input, `${command.name}.input`),
    outputSchema: toJsonSchema(command.output, `${command.name}.output`),
  }))
}

/**
 * 把命令描述整理成 `describe --schema` 的目录：definitions 以命令名为键。
 * @param commands 命令描述列表
 * @returns 带 $schema 与 definitions 的目录对象
 */
export function commandSchemaCatalog(
  commands: readonly CommandDescription[],
): Record<string, unknown> {
  const definitions: Record<string, CommandSchemaEntry> = {}
  for (const command of commands) {
    definitions[command.name] = { input: command.inputSchema, output: command.outputSchema }
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ledger-command-catalog',
    description: '按命令名索引的输入与输出 JSON Schema 目录。',
    definitions,
  }
}
