/**
 * 核心命令注册：把领域命令一次性登记到命令注册表，供 CLI / HTTP / MCP 复用。
 */
import type { CommandRegistry } from './registry.js'
import {
  contractDeleteCommand,
  contractGetCommand,
  contractListCommand,
  contractStatusLogsCommand,
  contractUpsertCommand,
} from './handlers/contract.js'
import {
  deliveryDeleteCommand,
  deliveryListCommand,
  deliveryRecordCommand,
} from './handlers/delivery.js'
import { dictDeleteCommand, dictListCommand, dictUpsertCommand } from './handlers/dict.js'
import {
  paymentDeleteCommand,
  paymentListCommand,
  paymentRecordCommand,
} from './handlers/payment.js'
import {
  personnelDeleteCommand,
  personnelListCommand,
  personnelTransferCommand,
  personnelUpsertCommand,
} from './handlers/personnel.js'

/**
 * 注册全部核心领域命令（合同 / 资金 / 交付 / 人员 / 字典）。
 * @param registry 命令注册表
 */
export function registerCoreCommands(registry: CommandRegistry): void {
  registry.register(contractUpsertCommand)
  registry.register(contractGetCommand)
  registry.register(contractListCommand)
  registry.register(contractDeleteCommand)
  registry.register(contractStatusLogsCommand)

  registry.register(paymentRecordCommand)
  registry.register(paymentListCommand)
  registry.register(paymentDeleteCommand)

  registry.register(deliveryRecordCommand)
  registry.register(deliveryListCommand)
  registry.register(deliveryDeleteCommand)

  registry.register(personnelUpsertCommand)
  registry.register(personnelListCommand)
  registry.register(personnelDeleteCommand)
  registry.register(personnelTransferCommand)

  registry.register(dictUpsertCommand)
  registry.register(dictListCommand)
  registry.register(dictDeleteCommand)
}
