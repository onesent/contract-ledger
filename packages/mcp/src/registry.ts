/**
 * 命令注册表装配：优先使用 core 导出的 registerCoreCommands，
 * 命令实现尚未落地时返回空注册表，保证 MCP server 与发现脚本仍可启动。
 */
import * as core from '@ledger/core'
import { CommandRegistry } from '@ledger/core'

/** core 未来可能导出的注册函数形状；缺失时按空注册表处理。 */
interface CoreCommandModule {
  registerCoreCommands?: (registry: CommandRegistry) => void
}

/**
 * 判断 core 是否已导出 registerCoreCommands，并在存在时注册全部核心命令。
 * @param registry 目标注册表
 * @returns 是否实际执行了核心命令注册
 */
export function registerCoreCommandsIfPresent(registry: CommandRegistry): boolean {
  const module: CoreCommandModule = core
  if (typeof module.registerCoreCommands !== 'function') return false
  module.registerCoreCommands(registry)
  return true
}

/**
 * 构造包含全部核心命令的注册表。
 * @returns 命令注册表；core 未导出 registerCoreCommands 时为空表
 */
export function createCoreRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registerCoreCommandsIfPresent(registry)
  return registry
}
