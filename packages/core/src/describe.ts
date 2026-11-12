/**
 * 能力自描述：输出错误码目录、JSON Schema 与数据集 schema 版本。
 * 供 `ledger describe --json`、MCP tools/list 与 agent 构造合法命令使用。
 */
import { ERROR_CATALOG, type ErrorCode, type ErrorDefinition } from './contracts/error-codes.js'
import { jsonSchemas, type JsonSchemaObject } from './schema/index.js'

/** 描述输出中的错误码条目。 */
export interface DescribedErrorCode {
  readonly code: ErrorCode
  readonly httpStatus: number
  readonly retryable: boolean
  readonly hint: string
}

/** 描述输出中的 schema 条目。 */
export interface DescribedSchema {
  readonly name: string
  readonly jsonSchema: JsonSchemaObject
}

/** core 能力描述。 */
export interface CoreDescription {
  readonly schemaVersion: number
  readonly errorCodes: readonly DescribedErrorCode[]
  readonly schemas: readonly DescribedSchema[]
}

/** 数据集 schema 版本（新库为 3）。 */
const DATASET_SCHEMA_VERSION = 3

/**
 * 类型守卫：字符串是否为冻结错误码。
 * @param value 待判断值
 * @returns 是否为 ErrorCode
 */
function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CATALOG, value)
}

/**
 * 获取错误码定义。
 * @param code 冻结错误码
 * @returns HTTP 状态、可重试性与修复建议
 */
export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
  return ERROR_CATALOG[code]
}

/**
 * 生成 core 的能力描述。
 * @returns schema 版本、全部错误码与全部 JSON Schema
 */
export function describeCore(): CoreDescription {
  const errorCodes = Object.keys(ERROR_CATALOG).filter(isErrorCode).map((code) => {
    const definition = ERROR_CATALOG[code]
    return {
      code,
      httpStatus: definition.httpStatus,
      retryable: definition.retryable,
      hint: definition.hint,
    }
  })
  const schemas = Object.entries(jsonSchemas()).map(([name, jsonSchema]) => ({ name, jsonSchema }))
  return { schemaVersion: DATASET_SCHEMA_VERSION, errorCodes, schemas }
}
