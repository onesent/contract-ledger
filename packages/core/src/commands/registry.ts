/**
 * 命令注册表：单一命令定义同时驱动 CLI / HTTP / MCP 三个适配器。
 * 命令名使用点号形式（如 contract.upsert），MCP 适配器负责转成 snake_case。
 */
import type { z } from 'zod'
import type { Transport } from '../contracts/envelope.js'
import type { ErrorCode } from '../contracts/error-codes.js'
import type { LedgerStore } from '../contracts/store-port.js'

/** 工具安全注解：暴露给 agent 的提示，必须与命令实际行为一致。 */
export interface CommandAnnotations {
  /** 只读命令不写库，也不要求幂等键。 */
  readOnlyHint: boolean
  /** 破坏性命令（删除、清空）需二次确认。 */
  destructiveHint: boolean
  /** 相同幂等键重复提交返回首次结果。 */
  idempotentHint: boolean
  /** 是否会访问外部世界；本台账命令恒为 false。 */
  openWorldHint: boolean
}

/** 命令执行上下文：由分发器在事务/只读快照内提供。 */
export interface CommandContext {
  store: LedgerStore
  actor: string
  transport: Transport
  dryRun: boolean
  /** 只读命令可能为空字符串；写命令由分发器保证非空。 */
  idempotencyKey: string
  expectedVersion?: number
}

/** 命令处理结果：业务数据与可选的字段级差异。 */
export interface CommandHandlerOutput<O> {
  data: O
  diff?: unknown
}

/**
 * 单条命令定义。
 * @template I 入参类型（由 input schema 推导）
 * @template O 出参类型（由 output schema 推导）
 */
export interface CommandDef<I, O> {
  /** 点号命令名，例如 contract.upsert / payment.record。 */
  name: string
  /** 面向 agent 的一句话说明。 */
  summary: string
  input: z.ZodType<I>
  output: z.ZodType<O>
  annotations: CommandAnnotations
  /** 该命令可能返回的稳定错误码，供 describe 自描述使用。 */
  errorCodes: readonly ErrorCode[]
  handler: (input: I, ctx: CommandContext) => Promise<CommandHandlerOutput<O>>
}

/**
 * 类型擦除后的注册项：登记时把泛型 I/O 收进闭包，分发器只与 unknown 打交道。
 * 入参在 `run` 内重新 parse 一次，保证 handler 拿到的是 schema 输出而非原始入参。
 */
export interface RegisteredCommand {
  readonly name: string
  readonly summary: string
  readonly input: z.ZodType<unknown>
  readonly output: z.ZodType<unknown>
  readonly annotations: CommandAnnotations
  readonly errorCodes: readonly ErrorCode[]
  /** 仅校验入参，供分发器计算 canonical 指纹。 */
  readonly parseInput: (rawInput: unknown) => unknown
  /** 校验入参后执行 handler；失败时抛 ZodError / LedgerError。 */
  readonly run: (rawInput: unknown, ctx: CommandContext) => Promise<CommandHandlerOutput<unknown>>
}

/**
 * 构造类型擦除的注册项。
 * @param def 带泛型的命令定义
 * @returns 分发表可安全保存的注册项
 */
function createRegisteredCommand<I, O>(def: CommandDef<I, O>): RegisteredCommand {
  return {
    name: def.name,
    summary: def.summary,
    input: def.input,
    output: def.output,
    annotations: def.annotations,
    errorCodes: def.errorCodes,
    parseInput: (rawInput) => def.input.parse(rawInput),
    run: async (rawInput, ctx) => def.handler(def.input.parse(rawInput), ctx),
  }
}

/**
 * 命令注册表：按注册顺序稳定列出，重复命令名直接拒绝。
 */
export class CommandRegistry {
  private readonly commands = new Map<string, RegisteredCommand>()

  /**
   * 注册命令；同名重复注册会抛错（中文消息，便于 CLI 直接展示）。
   * @param def 命令定义
   * @throws {Error} 命令名已存在
   */
  register<I, O>(def: CommandDef<I, O>): void {
    if (this.commands.has(def.name)) {
      throw new Error(`命令已注册：${def.name}`)
    }
    this.commands.set(def.name, createRegisteredCommand(def))
  }

  /**
   * 按名称取得命令。
   * @param name 点号命令名
   * @returns 注册项；未注册返回 null
   */
  get(name: string): RegisteredCommand | null {
    return this.commands.get(name) ?? null
  }

  /**
   * 按注册顺序列出全部命令。
   * @returns 注册项副本数组
   */
  list(): RegisteredCommand[] {
    return [...this.commands.values()]
  }
}

/**
 * 定义命令的辅助函数，保留 I / O 推导并可获得内联提示。
 * @param def 命令定义
 * @returns 原样返回的命令定义
 */
export function defineCommand<I, O>(def: CommandDef<I, O>): CommandDef<I, O> {
  return def
}
