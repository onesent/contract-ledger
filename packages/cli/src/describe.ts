import { describeCore as describeCoreCatalog, type CoreDescription } from '@ledger/core'

/** 命令摘要；Wave 4.1 / 4.4 填充真实命令后替换占位空数组。 */
export interface CommandSummary {
  name: string
  summary: string
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
 * 把 core 的 schema 列表整理成单份 JSON Schema 目录，供 `describe --schema` 输出。
 * @param catalog core 能力描述
 * @returns 带 $schema 与 definitions 的目录对象
 */
export function jsonSchemaCatalog(catalog: CoreDescription): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ledger-command-catalog',
    description: '命令输入与输出 JSON Schema 目录；命令级 schema 在 Wave 4.4 补齐。',
    definitions: Object.fromEntries(catalog.schemas.map((entry) => [entry.name, entry.jsonSchema])),
  }
}
