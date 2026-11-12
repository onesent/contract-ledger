import { describe, expect, it } from 'vitest'
import { CommandRegistry, registerCoreCommands } from '@ledger/core'

/** 只读命令清单。 */
const READ_COMMANDS = [
  'contract.get',
  'contract.list',
  'contract.statusLogs',
  'payment.list',
  'delivery.list',
  'personnel.list',
  'dict.list',
] as const

/** 破坏性命令清单。 */
const DESTRUCTIVE_COMMANDS = [
  'contract.delete',
  'payment.delete',
  'delivery.delete',
  'personnel.delete',
  'personnel.transfer',
  'dict.delete',
] as const

/**
 * 构造已注册核心命令的注册表。
 * @returns 命令注册表
 */
function setup(): CommandRegistry {
  const registry = new CommandRegistry()
  registerCoreCommands(registry)
  return registry
}

describe('registerCoreCommands', () => {
  it('注册 18 条命令且名称唯一', () => {
    const registry = setup()
    const commands = registry.list()
    expect(commands).toHaveLength(18)
    const names = commands.map((command) => command.name)
    expect(new Set(names).size).toBe(18)
    expect(names).toContain('contract.upsert')
    expect(names).toContain('contract.statusLogs')
    expect(names).toContain('personnel.transfer')
    expect(names).toContain('dict.upsert')
  })

  it('只读命令 readOnlyHint 为 true，写命令为 false', () => {
    const registry = setup()
    for (const command of registry.list()) {
      const isRead = (READ_COMMANDS as readonly string[]).includes(command.name)
      expect(command.annotations.readOnlyHint).toBe(isRead)
    }
  })

  it('删除与转交命令 destructiveHint 为 true，其余为 false', () => {
    const registry = setup()
    for (const command of registry.list()) {
      const isDestructive = (DESTRUCTIVE_COMMANDS as readonly string[]).includes(command.name)
      expect(command.annotations.destructiveHint).toBe(isDestructive)
    }
  })

  it('所有写命令 idempotentHint 为 true，全部命令 openWorldHint 为 false', () => {
    const registry = setup()
    for (const command of registry.list()) {
      expect(command.annotations.openWorldHint).toBe(false)
      if (!command.annotations.readOnlyHint) {
        expect(command.annotations.idempotentHint).toBe(true)
      }
      expect(command.errorCodes.length).toBeGreaterThan(0)
    }
  })

  it('重复注册同一批命令会抛错（注册表自身守卫）', () => {
    const registry = setup()
    expect(() => registerCoreCommands(registry)).toThrow('命令已注册：contract.upsert')
  })
})
