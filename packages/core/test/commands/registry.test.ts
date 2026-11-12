import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CommandRegistry, defineCommand, type CommandDef } from '@ledger/core'

/**
 * 构造仅用于注册表测试的最小命令。
 * @param name 命令名
 * @returns 命令定义
 */
function makeCommand(name: string): CommandDef<Record<string, never>, Record<string, never>> {
  return defineCommand({
    name,
    summary: `命令 ${name}`,
    input: z.object({}).strict(),
    output: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    errorCodes: [],
    handler: async () => ({ data: {} }),
  })
}

describe('CommandRegistry', () => {
  it('按注册顺序稳定列出命令', () => {
    const registry = new CommandRegistry()
    registry.register(makeCommand('contract.list'))
    registry.register(makeCommand('contract.get'))
    registry.register(makeCommand('payment.record'))
    expect(registry.list().map((command) => command.name)).toEqual([
      'contract.list',
      'contract.get',
      'payment.record',
    ])
  })

  it('重复注册同名命令时抛出中文错误', () => {
    const registry = new CommandRegistry()
    registry.register(makeCommand('contract.upsert'))
    expect(() => registry.register(makeCommand('contract.upsert'))).toThrow('命令已注册：contract.upsert')
  })

  it('get 返回注册项，未注册命令返回 null', () => {
    const registry = new CommandRegistry()
    registry.register(makeCommand('contract.get'))
    const command = registry.get('contract.get')
    expect(command).not.toBeNull()
    expect(command?.summary).toBe('命令 contract.get')
    expect(command?.annotations.readOnlyHint).toBe(true)
    expect(registry.get('contract.missing')).toBeNull()
  })
})
