/**
 * 领域命令执行适配器：调用 core 分发器、输出统一信封并返回进程退出码。
 * CLI 只做参数搬运与输出格式化，校验/幂等/版本冲突全部由分发器负责。
 */
import { dispatch, type CommandRegistry, type LedgerStore } from '@ledger/core'
import { EXIT_OK, exitCodeForErrorCode } from './exit-codes.js'
import { printResult } from './output.js'

/** 执行一条领域命令所需的运行参数。 */
export interface RunCliCommandOptions {
  /** 共享的版本化存储。 */
  store: LedgerStore
  /** 操作者标识（审计用）。 */
  actor: string
  /** 是否只预览变更。 */
  dryRun?: boolean
  /** 写命令的幂等键。 */
  idempotencyKey?: string
  /** 乐观并发期望版本。 */
  expectedVersion?: number
}

/**
 * 执行命令并打印 JSON 信封。
 *
 * 成功返回 0；失败按错误码映射退出码（认证 4 / 用法 2 / 业务 1）。
 * 本函数不调用 `process.exit()`，由上层决定进程退出行为。
 * @param registry 命令注册表
 * @param name 点号命令名
 * @param input 已解析的原始入参
 * @param options 存储、操作者与幂等/版本参数
 * @returns 进程退出码
 */
export async function runCliCommand(
  registry: CommandRegistry,
  name: string,
  input: unknown,
  options: RunCliCommandOptions,
): Promise<number> {
  const result = await dispatch(registry, name, input, {
    store: options.store,
    actor: options.actor,
    transport: 'cli',
    dryRun: options.dryRun,
    idempotencyKey: options.idempotencyKey,
    expectedVersion: options.expectedVersion,
  })
  printResult(name, result)
  return result.ok ? EXIT_OK : exitCodeForErrorCode(result.code)
}
