/**
 * 命令分发器：统一入参校验、幂等键检查、乐观并发、dry-run 与错误映射。
 * 传输适配器只负责构造 options 并把 CommandResult 转成各自的信封。
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  CommandResult,
  FailureResult,
  ResultMeta,
  Transport,
} from '../contracts/envelope.js'
import { failureResult, successResult } from '../contracts/envelope.js'
import { LedgerError } from '../contracts/ledger-error.js'
import type { LedgerStore, WriteMutation, WriteOptions, WriteResult } from '../contracts/store-port.js'
import { fingerprint } from './canonical.js'
import type { CommandContext, CommandRegistry, RegisteredCommand } from './registry.js'

/**
 * 分发器对存储的要求：写回调可能返回 Promise。
 * `LedgerStore.write` 的端口签名因冻结历史仍写成同步回调，但实现内部会 await 回调结果；
 * 这里用结构等价的宽签名调用，避免把 Promise 塞进 `WriteMutation<T>`。
 */
export interface CommandStore extends Omit<LedgerStore, 'write'> {
  write<T>(
    fn: () => WriteMutation<T> | Promise<WriteMutation<T>>,
    options: WriteOptions,
  ): Promise<WriteResult<T>>
}

/** 分发参数：store 必填，幂等键与期望版本按命令类型可选。 */
export interface DispatchOptions {
  store: LedgerStore
  actor: string
  transport: Transport
  dryRun?: boolean
  idempotencyKey?: string
  expectedVersion?: number
}

/** 字段级校验错误，对应 details.fields。 */
export interface FieldIssue {
  path: string
  message: string
  code: string
}

/**
 * 把 Zod issue 转成稳定的字段路径列表。
 * @param error Zod 校验错误
 * @returns 字段级错误数组
 */
function toFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
    code: issue.code,
  }))
}

/**
 * 把执行期异常映射为统一失败信封。
 * @param error 任意异常
 * @param meta 结果元信息
 * @returns 失败信封（LedgerError 保留 code/details，ZodError 转 VALIDATION_FAILED，其余 INTERNAL）
 */
function toFailure(error: unknown, meta: ResultMeta): FailureResult {
  if (error instanceof LedgerError) {
    return failureResult({ code: error.code, message: error.message, details: error.details, meta })
  }
  if (error instanceof z.ZodError) {
    const fields = toFieldIssues(error)
    return failureResult({
      code: 'VALIDATION_FAILED',
      message: `入参校验失败，共 ${fields.length} 项。`,
      details: { fields },
      meta,
    })
  }
  // 未知异常只暴露 message，绝不把堆栈写进信封。
  const message = error instanceof Error && error.message !== ''
    ? `命令执行失败：${error.message}`
    : '命令执行失败。'
  return failureResult({ code: 'INTERNAL', message, meta })
}

/**
 * 解析写命令的幂等键：去空白后为空即视为缺失。
 * @param raw 调用方传入的幂等键
 * @returns 去空白后的幂等键（可能为空字符串）
 */
function normalizeIdempotencyKey(raw: string | undefined): string {
  return (raw ?? '').trim()
}

/**
 * 执行一条命令。
 * @param registry 命令注册表
 * @param name 点号命令名
 * @param rawInput 原始入参（未校验）
 * @param options 存储、操作者、通道与可选幂等/版本参数
 * @returns 统一命令结果信封
 */
export async function dispatch(
  registry: CommandRegistry,
  name: string,
  rawInput: unknown,
  options: DispatchOptions,
): Promise<CommandResult<unknown>> {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const dryRun = options.dryRun === true
  const buildMeta = (): ResultMeta => ({
    requestId,
    durationMs: Date.now() - startedAt,
    dryRun,
    actor: options.actor,
    transport: options.transport,
  })

  const command: RegisteredCommand | null = registry.get(name)
  if (command === null) {
    return failureResult({
      code: 'NOT_FOUND',
      message: `未知命令：${name}`,
      details: { command: name },
      meta: buildMeta(),
    })
  }

  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey)
  const ctx: CommandContext = {
    store: options.store,
    actor: options.actor,
    transport: options.transport,
    dryRun,
    idempotencyKey,
    expectedVersion: options.expectedVersion,
  }

  try {
    // 先校验入参：验证失败不得触碰存储，指纹也只基于 schema 解析后的值。
    const parsedInput = command.parseInput(rawInput)

    if (!command.annotations.readOnlyHint && idempotencyKey === '') {
      return failureResult({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: `写命令必须携带幂等键：${command.name}`,
        details: { command: command.name },
        meta: buildMeta(),
      })
    }

    let handlerOutput: { data: unknown; diff?: unknown }
    let version: number
    let diff: unknown

    if (command.annotations.readOnlyHint) {
      handlerOutput = await options.store.read(() => command.run(rawInput, ctx))
      version = options.store.getVersion()
      diff = handlerOutput.diff
    } else {
      // 端口签名冻结为同步回调，但实际实现支持 async；结构化赋值不改变运行时行为。
      const writable: CommandStore = options.store
      const writeOptions: WriteOptions = {
        actor: options.actor,
        command: command.name,
        idempotencyKey,
        inputFingerprint: fingerprint(parsedInput),
        expectedVersion: options.expectedVersion,
        dryRun,
        transport: options.transport,
      }
      const writeResult = await writable.write(
        async () => {
          const output = await command.run(rawInput, ctx)
          return { result: output.data, diff: output.diff }
        },
        writeOptions,
      )
      handlerOutput = { data: writeResult.result, diff: writeResult.diff }
      version = writeResult.version
      diff = writeResult.diff
    }

    const outputCheck = command.output.safeParse(handlerOutput.data)
    if (!outputCheck.success) {
      const issues = toFieldIssues(outputCheck.error)
      return failureResult({
        code: 'INTERNAL',
        message: `命令输出不符合 schema：${command.name}`,
        details: { issues },
        meta: buildMeta(),
      })
    }

    return successResult({ data: outputCheck.data, version, diff, meta: buildMeta() })
  } catch (error) {
    return toFailure(error, buildMeta())
  }
}
