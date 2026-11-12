/**
 * 命令层测试夹具：构造合法合同/流水行，并提供一组覆盖读、写、dry-run 与批量的命令。
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  CommandRegistry,
  defineCommand,
  LedgerError,
  type ContractRow,
  type PaymentRow,
} from '@ledger/core'

/** 测试合同 id（合法 UUID v4，供 z.uuid() 通过）。 */
export const CONTRACT_ID = '11111111-1111-4111-8111-111111111111'

/** 测试合同编号。 */
export const CONTRACT_NO = 'HT-2026-001'

/**
 * 构造完整合同行；派生字段按开账余额与流水为零的初始状态给出。
 * @param overrides 需要覆盖的字段
 * @returns 合同行
 */
export function makeContract(overrides: Partial<ContractRow> = {}): ContractRow {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    id: CONTRACT_ID,
    no: CONTRACT_NO,
    projectName: '测试项目',
    direction: 'sale',
    counterparty: '甲方单位',
    typeItemId: '22222222-2222-4222-8222-222222222222',
    typeCode: 'sales',
    typeName: '销售合同',
    statusItemId: '33333333-3333-4333-8333-333333333333',
    statusCode: 'executing',
    statusName: '执行中',
    amountCents: 100000,
    openingPaidCents: 0,
    paidCents: 0,
    unpaidCents: 100000,
    receivedAmountCents: 0,
    openingDeliveredCents: 0,
    deliveredCents: 0,
    lastDeliveryDate: null,
    fundingPercent: 0,
    deliveryPercent: 0,
    executionGapCents: 0,
    gapState: 'none',
    ownerId: null,
    ownerName: '',
    note: '',
    signDate: '2026-01-01',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
    statusChangedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

/**
 * 构造资金流水行。
 * @param contractId 合同 id
 * @param amountCents 金额（分）
 * @param overrides 需要覆盖的字段
 * @returns 流水行
 */
export function makePayment(
  contractId: string,
  amountCents: number,
  overrides: Partial<PaymentRow> = {},
): PaymentRow {
  const timestamp = '2026-02-01T00:00:00.000Z'
  return {
    id: randomUUID(),
    contractId,
    date: '2026-02-01',
    amountCents,
    methodCode: 'transfer',
    note: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

/** 只读合同摘要命令。 */
const getContract = defineCommand({
  name: 'contract.get',
  summary: '按 id 读取合同摘要',
  input: z.object({ id: z.uuid() }).strict(),
  output: z.object({ id: z.uuid(), amountCents: z.int() }).strict(),
  annotations: READ_ANNOTATIONS,
  errorCodes: ['NOT_FOUND'],
  handler: async (input, ctx) => {
    const contract = ctx.store.contracts.getById(input.id)
    if (contract === null) {
      throw new LedgerError('NOT_FOUND', `合同不存在：${input.id}`, { id: input.id })
    }
    return { data: { id: contract.id, amountCents: contract.amountCents } }
  },
})

/** 登记付款命令。 */
const recordPayment = defineCommand({
  name: 'payment.record',
  summary: '为合同登记一笔付款',
  input: z
    .object({
      contractId: z.uuid(),
      date: z.iso.date(),
      amountCents: z.int().positive(),
    })
    .strict(),
  output: z
    .object({ id: z.uuid(), contractId: z.uuid(), amountCents: z.int().positive() })
    .strict(),
  annotations: WRITE_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED', 'NOT_FOUND', 'PAYMENT_EXCEEDS_CONTRACT_AMOUNT'],
  handler: async (input, ctx) => {
    const row = makePayment(input.contractId, input.amountCents, { date: input.date })
    ctx.store.payments.insert(row)
    return { data: { id: row.id, contractId: row.contractId, amountCents: row.amountCents } }
  },
})

/** 调整合同金额命令（用于 dry-run diff）。 */
const adjustContract = defineCommand({
  name: 'contract.adjust',
  summary: '调整合同金额',
  input: z.object({ id: z.uuid(), amountCents: z.int().min(0) }).strict(),
  output: z.object({ id: z.uuid(), amountCents: z.int() }).strict(),
  annotations: WRITE_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED', 'NOT_FOUND'],
  handler: async (input, ctx) => {
    const contract = ctx.store.contracts.getById(input.id)
    if (contract === null) {
      throw new LedgerError('NOT_FOUND', `合同不存在：${input.id}`, { id: input.id })
    }
    const next: ContractRow = { ...contract, amountCents: input.amountCents }
    ctx.store.contracts.update(next)
    return {
      data: { id: next.id, amountCents: next.amountCents },
      diff: { amountCents: { from: contract.amountCents, to: input.amountCents } },
    }
  },
})

/** 批量付款命令：第 2 条之后抛错，用于验证整批回滚。 */
const batchPayments = defineCommand({
  name: 'payment.batch',
  summary: '批量登记付款（第 2 条后抛错，验证原子性）',
  input: z
    .object({
      contractId: z.uuid(),
      amounts: z.array(z.int().positive()).min(1),
    })
    .strict(),
  output: z.object({ inserted: z.int() }).strict(),
  annotations: WRITE_ANNOTATIONS,
  errorCodes: ['VALIDATION_FAILED', 'NOT_FOUND', 'PAYMENT_EXCEEDS_CONTRACT_AMOUNT'],
  handler: async (input, ctx) => {
    for (const [index, amountCents] of input.amounts.entries()) {
      ctx.store.payments.insert(makePayment(input.contractId, amountCents))
      if (index === 1) {
        throw new LedgerError('VALIDATION_FAILED', '批量命令第 2 条金额校验失败。', { index })
      }
    }
    return { data: { inserted: input.amounts.length } }
  },
})

/**
 * 创建包含上述全部命令的注册表。
 * @returns 命令注册表
 */
export function createTestRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registry.register(getContract)
  registry.register(recordPayment)
  registry.register(adjustContract)
  registry.register(batchPayments)
  return registry
}
