import {
  LedgerError,
  type ContractRepository,
  type DeliveryRepository,
  type DictRepository,
  type LedgerStore,
  type PaymentRepository,
  type PersonnelRepository,
  type WriteMutation,
  type WriteOptions,
  type WriteResult,
} from '@ledger/core'
import type { Database } from './db.js'
import { createRepoRuntime } from './kysely.js'
import { SqliteContractRepository } from './repo/contracts.js'
import { SqliteDeliveryRepository } from './repo/deliveries.js'
import { SqliteDictRepository } from './repo/dicts.js'
import { SqlitePaymentRepository } from './repo/payments.js'
import { SqlitePersonnelRepository } from './repo/personnel.js'
import { busyError, isBusyError, toTriggerError } from './store-errors.js'
import {
  auditRows,
  findIdempotency,
  parseStoredResult,
  persistAudit,
  persistIdempotency,
  persistVersion,
  readDatasetVersion,
} from './store-records.js'

export { auditRows, readDatasetVersion }
export type { AuditRow } from './store-records.js'

/** 仓储集合；未提供时由 store 基于同一连接构建。 */
export interface LedgerRepositories {
  readonly contracts: ContractRepository
  readonly payments: PaymentRepository
  readonly deliveries: DeliveryRepository
  readonly personnel: PersonnelRepository
  readonly dicts: DictRepository
}

/**
 * SQLite 版本化存储：所有写操作在单事务内完成版本递增、幂等记录与审计。
 */
export class SqliteLedgerStore implements LedgerStore {
  readonly contracts: ContractRepository
  readonly payments: PaymentRepository
  readonly deliveries: DeliveryRepository
  readonly personnel: PersonnelRepository
  readonly dicts: DictRepository

  /**
   * @param db 已打开的数据库连接
   * @param repos 可选的仓储覆盖（测试或上层复用已有实例）
   */
  constructor(
    private readonly db: Database,
    repos?: Partial<LedgerRepositories>,
  ) {
    const runtime = createRepoRuntime(db)
    this.contracts = repos?.contracts ?? new SqliteContractRepository(runtime)
    this.payments = repos?.payments ?? new SqlitePaymentRepository(runtime)
    this.deliveries = repos?.deliveries ?? new SqliteDeliveryRepository(runtime)
    this.personnel = repos?.personnel ?? new SqlitePersonnelRepository(runtime)
    this.dicts = repos?.dicts ?? new SqliteDictRepository(runtime)
  }

  getVersion(): number {
    return readDatasetVersion(this.db)
  }

  read<T>(fn: () => T): T {
    return fn()
  }

  async write<T>(fn: () => WriteMutation<T>, options: WriteOptions): Promise<WriteResult<T>> {
    if (typeof options.idempotencyKey !== 'string' || options.idempotencyKey.trim() === '') {
      throw new LedgerError('IDEMPOTENCY_KEY_REQUIRED', '写操作必须携带幂等键。')
    }
    if (this.db.inTransaction) {
      throw new LedgerError('INTERNAL', '检测到嵌套事务：写事务不可重入。')
    }

    try {
      this.db.exec('BEGIN IMMEDIATE')
    } catch (error) {
      if (isBusyError(error)) throw busyError()
      throw error
    }

    try {
      const current = this.getVersion()
      if (options.expectedVersion !== undefined && options.expectedVersion !== current) {
        throw new LedgerError('STALE_WRITE', '数据集版本已变化，请重新读取当前版本后重试。', {
          currentVersion: current,
        })
      }

      const stored = findIdempotency(this.db, {
        actor: options.actor,
        command: options.command,
        key: options.idempotencyKey,
      })
      if (stored) {
        if (stored.fingerprint !== options.inputFingerprint) {
          throw new LedgerError('IDEMPOTENCY_KEY_REUSED', '同一幂等键已用于不同输入内容。', {
            storedFingerprint: stored.fingerprint,
          })
        }
        this.db.exec('ROLLBACK')
        return { result: parseStoredResult<T>(stored.result_json), version: stored.version, replayed: true }
      }

      // 命令分发传入的 handler 是 async；必须 await 后才读取 result/diff，
      // 否则会拿到 Promise 并在空事务上提交。
      const mutation = await fn()

      if (options.dryRun === true) {
        this.db.exec('ROLLBACK')
        return { result: mutation.result, version: current, diff: mutation.diff, replayed: false }
      }

      const next = current + 1
      persistVersion(this.db, next)
      persistIdempotency(this.db, {
        actor: options.actor,
        command: options.command,
        key: options.idempotencyKey,
        fingerprint: options.inputFingerprint,
        result: mutation.result,
        version: next,
      })
      persistAudit(this.db, {
        actor: options.actor,
        transport: options.transport ?? 'internal',
        command: options.command,
        idempotencyKey: options.idempotencyKey,
        fromVersion: current,
        toVersion: next,
      })
      this.db.exec('COMMIT')
      return { result: mutation.result, version: next, diff: mutation.diff, replayed: false }
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK')
      if (error instanceof LedgerError) throw error
      if (isBusyError(error)) throw busyError()
      const triggerError = toTriggerError(error)
      if (triggerError) throw triggerError
      throw error
    }
  }
}

/**
 * 创建 SQLite 版本化存储。
 * @param db 已打开的数据库连接
 * @param repos 可选的仓储覆盖
 */
export function createLedgerStore(db: Database, repos?: Partial<LedgerRepositories>): SqliteLedgerStore {
  return new SqliteLedgerStore(db, repos)
}
