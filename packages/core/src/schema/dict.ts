/**
 * 字典 schema：分类 + 字典项；颜色为可选十六进制，排序与启用有默认值。
 */
import { z } from 'zod'
import { hexColor, nonEmptyString } from './primitives.js'

/** 字典分类入参。 */
export const dictCategorySchema = z
  .object({
    code: nonEmptyString(64),
    name: nonEmptyString(50),
  })
  .strict()

/** 字典项入参。 */
export const dictItemSchema = z
  .object({
    categoryCode: nonEmptyString(64),
    code: nonEmptyString(64),
    name: nonEmptyString(50),
    color: hexColor.optional(),
    enabled: z.boolean().default(true),
    sort: z.int().default(0),
    builtin: z.boolean().default(false),
  })
  .strict()

/** 字典分类入参类型。 */
export type DictCategoryInput = z.infer<typeof dictCategorySchema>
/** 字典项入参类型。 */
export type DictItemInput = z.infer<typeof dictItemSchema>
