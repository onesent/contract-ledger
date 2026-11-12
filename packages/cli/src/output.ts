import type { CliEnvelope, CommandResult } from '@ledger/core'

/**
 * 把命令结果包成 CLI 信封：CLI 只在统一信封上增加 `schema_version` 与 `command`。
 * 字段名保持跨传输层一致（内部 camelCase），不在适配器里改写业务字段。
 * @param command 命令名（例如 `describe`）
 * @param result 统一命令结果
 * @returns 可序列化的 CLI 信封
 */
export function toEnvelope(command: string, result: CommandResult<unknown>): CliEnvelope {
  return { schema_version: 1, command, ...result }
}

/**
 * 向 stdout 写入一条 JSON 信封（单行 + 换行）。
 * 无论是否 `--json` 模式都输出 JSON；人类可读日志一律走 stderr，保证 stdout 机器可解析。
 * @param command 命令名
 * @param result 统一命令结果
 */
export function printResult(command: string, result: CommandResult<unknown>): void {
  process.stdout.write(`${JSON.stringify(toEnvelope(command, result))}\n`)
}

/**
 * 向 stderr 写入人类可读信息；stdout 永远只承载机器可解析的 JSON。
 * @param message 日志或错误文案
 */
export function printError(message: string): void {
  process.stderr.write(`${message}\n`)
}
