import { describe, expect, it } from 'vitest'
import {
  contractCreateSchema,
  contractSchema,
  contractUpdateSchema,
  deliverySchema,
  dictCategorySchema,
  dictItemSchema,
  jsonSchemas,
  paymentSchema,
  personnelSchema,
  schemaCatalog,
} from '@ledger/core'

const VALID_CONTRACT = {
  id: '11111111-1111-4111-8111-111111111111',
  no: ' HT-2026-001 ',
  counterparty: '星海科技有限公司',
  direction: 'sale',
  typeCode: 'sales',
  statusCode: 'executing',
  ownerId: null,
  amountCents: 100_000,
  signDate: '2026-01-01',
  startDate: '2026-01-01',
  dueDate: '2026-12-31',
}

describe('contractCreateSchema', () => {
  it('接受合法输入并 trim 编号、补齐默认值', () => {
    const parsed = contractCreateSchema.parse(VALID_CONTRACT)
    expect(parsed.no).toBe('HT-2026-001')
    expect(parsed.projectName).toBe('')
    expect(parsed.ownerName).toBe('')
    expect(parsed.note).toBe('')
  })

  it('缺少必填字段时失败', () => {
    const withoutNo: Record<string, unknown> = { ...VALID_CONTRACT }
    delete withoutNo.no
    expect(contractCreateSchema.safeParse(withoutNo).success).toBe(false)
  })

  it('拒绝非法方向枚举', () => {
    expect(contractCreateSchema.safeParse({ ...VALID_CONTRACT, direction: 'other' }).success).toBe(false)
  })

  it('拒绝未知字段', () => {
    expect(contractCreateSchema.safeParse({ ...VALID_CONTRACT, extra: true }).success).toBe(false)
  })

  it('到期日早于开始日时失败', () => {
    const result = contractCreateSchema.safeParse({
      ...VALID_CONTRACT,
      startDate: '2026-12-31',
      dueDate: '2026-01-01',
    })
    expect(result.success).toBe(false)
  })

  it('金额为负数时失败', () => {
    expect(contractCreateSchema.safeParse({ ...VALID_CONTRACT, amountCents: -1 }).success).toBe(false)
  })

  it('拒绝非法日期格式', () => {
    expect(contractCreateSchema.safeParse({ ...VALID_CONTRACT, signDate: '2026/01/01' }).success).toBe(false)
    expect(contractCreateSchema.safeParse({ ...VALID_CONTRACT, dueDate: '2026-02-30' }).success).toBe(false)
  })
})

describe('contractUpdateSchema', () => {
  it('除 id 外全部可选', () => {
    expect(contractUpdateSchema.safeParse({ id: VALID_CONTRACT.id }).success).toBe(true)
  })

  it('提供开始日与到期日时仍校验先后', () => {
    expect(
      contractUpdateSchema.safeParse({
        id: VALID_CONTRACT.id,
        startDate: '2026-12-31',
        dueDate: '2026-01-01',
      }).success,
    ).toBe(false)
  })
})

describe('contractSchema', () => {
  it('接受含时间戳的完整记录', () => {
    const result = contractSchema.safeParse({
      ...VALID_CONTRACT,
      projectName: '项目一',
      ownerName: '张伟',
      note: '',
      statusChangedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })
})

describe('payment / delivery / personnel / dict schemas', () => {
  it('资金流水金额必须大于 0', () => {
    const valid = {
      contractId: VALID_CONTRACT.id,
      date: '2026-01-10',
      amountCents: 100,
    }
    expect(paymentSchema.safeParse(valid).success).toBe(true)
    expect(paymentSchema.safeParse({ ...valid, amountCents: 0 }).success).toBe(false)
    expect(paymentSchema.safeParse({ ...valid, amountCents: 1.5 }).success).toBe(false)
  })

  it('交付明细拒绝非法验收状态', () => {
    const valid = {
      contractId: VALID_CONTRACT.id,
      date: '2026-01-10',
      amountCents: 100,
      quantity: null,
      status: 'delivered',
    }
    expect(deliverySchema.safeParse(valid).success).toBe(true)
    expect(deliverySchema.safeParse({ ...valid, status: 'unknown' }).success).toBe(false)
    expect(deliverySchema.safeParse({ ...valid, amountCents: -5 }).success).toBe(false)
  })

  it('人员默认在职且备注为空串', () => {
    const parsed = personnelSchema.parse({ code: 'YG-001', name: '张伟' })
    expect(parsed.active).toBe(true)
    expect(parsed.note).toBe('')
  })

  it('字典项默认启用、排序 0、非内置', () => {
    const parsed = dictItemSchema.parse({
      categoryCode: 'contractType',
      code: 'sales',
      name: '销售合同',
    })
    expect(parsed.enabled).toBe(true)
    expect(parsed.sort).toBe(0)
    expect(parsed.builtin).toBe(false)
  })

  it('字典分类与项拒绝未知字段', () => {
    expect(
      dictCategorySchema.safeParse({ code: 'contractType', name: '合同类型', extra: 1 }).success,
    ).toBe(false)
    expect(
      dictItemSchema.safeParse({
        categoryCode: 'contractType',
        code: 'sales',
        name: '销售合同',
        extra: 1,
      }).success,
    ).toBe(false)
  })
})

describe('schemaCatalog / jsonSchemas', () => {
  it('schema 目录包含全部领域 schema', () => {
    expect(Object.keys(schemaCatalog).sort()).toEqual([
      'contract',
      'contractCreate',
      'contractUpdate',
      'delivery',
      'dictCategory',
      'dictItem',
      'payment',
      'personnel',
    ])
  })

  it('JSON Schema 可 JSON 序列化且包含关键字段', () => {
    const schemas = jsonSchemas()
    expect(Object.keys(schemas)).toEqual(Object.keys(schemaCatalog))
    const contract = schemas.contractCreate
    expect(contract).toBeDefined()
    if (!contract) throw new Error('缺少 contractCreate JSON Schema')
    const properties = contract.properties
    expect(properties).toBeTypeOf('object')
    const required = contract.required
    expect(Array.isArray(required)).toBe(true)
    expect(required).toContain('no')
    expect(JSON.parse(JSON.stringify(schemas))).toEqual(schemas)
  })
})
