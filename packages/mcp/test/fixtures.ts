/**
 * MCP 测试夹具：一组只读、普通写与破坏性写命令，覆盖注解、幂等键与工具名映射。
 */
import { z } from 'zod'
import {
  CommandRegistry,
  defineCommand,
  LedgerError,
  MemoryLedgerStore,
  type CommandAnnotations,
  type ContractRow,
} from '@ledger/core'

/** 测试合同 id（合法 UUID，供 z.uuid() 通过）。 */
export const CONTRACT_ID = '11111111-1111-4111-8111-111111111111'

/** 测试合同编号。 */
export const CONTRACT_NO = 'HT-2026-001'

/** 只读命令注解。 */
const READ_ANNOTATIONS: CommandAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/** 普通写命令注解。 */
const WRITE_ANNOTATIONS: CommandAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/** 破坏性写命令注解。 */
const DESTRUCTIVE_ANNOTATIONS: CommandAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
}

/**
 * 构造完整合同行（派生字段按零流水初始状态给出）。
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

/** 按 id 读取合同摘要。 */
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

/** 调整合同金额（用于验证写命令幂等键）。 */
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

/** 删除合同（破坏性写命令）。 */
const removeContract = defineCommand({
  name: 'contract.remove',
  summary: '删除合同',
  input: z.object({ id: z.uuid() }).strict(),
  output: z.object({ id: z.uuid(), removed: z.boolean() }).strict(),
  annotations: DESTRUCTIVE_ANNOTATIONS,
  errorCodes: ['NOT_FOUND'],
  handler: async (input, ctx) => {
    ctx.store.contracts.delete(input.id)
    return { data: { id: input.id, removed: true } }
  },
})

/**
 * 创建覆盖三种注解的测试注册表。
 * @returns 命令注册表
 */
export function createTestRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registry.register(getContract)
  registry.register(adjustContract)
  registry.register(removeContract)
  return registry
}

/**
 * 创建已插入一条测试合同的内存存储。
 * @returns 内存存储
 */
export function createSeededStore(): MemoryLedgerStore {
  const store = new MemoryLedgerStore()
  store.contracts.insert(makeContract())
  return store
}
