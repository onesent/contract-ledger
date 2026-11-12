/**
 * 人员档案 schema：编号与姓名必填，其余可选；active 缺省为在职。
 */
import { z } from 'zod'
import { isoDate, nonEmptyString } from './primitives.js'

/** 人员档案入参。 */
export const personnelSchema = z
  .object({
    code: nonEmptyString(32),
    name: nonEmptyString(50),
    phone: z.string().max(32).optional(),
    departmentCode: z.string().max(64).optional(),
    active: z.boolean().default(true),
    hireDate: isoDate.optional(),
    note: z.string().max(500).default(''),
  })
  .strict()

/** 人员档案入参类型。 */
export type PersonnelInput = z.infer<typeof personnelSchema>
