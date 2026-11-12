/**
 * 并发测试工作线程：独立打开同一 SQLite 文件并执行一条命令，把统一信封发回主线程。
 * 单独线程是必要的：better-sqlite3 是同步驱动，主线程内两个连接竞争写锁时，
 * busy_timeout 会阻塞整个事件循环，无法验证真实的 busy_timeout 等待行为。
 */
import { parentPort, workerData } from 'node:worker_threads'
import {
  CommandRegistry,
  dispatch,
  registerCoreCommands,
  type CommandResult,
} from '@ledger/core'
import { createLedgerStore, openDatabase } from '@ledger/storage-sqlite'

/** 工作线程请求。 */
export interface ConcurrencyWorkerRequest {
  file: string
  command: string
  input: Record<string, unknown>
  actor: string
  idempotencyKey: string
  expectedVersion?: number
}

/** 工作线程响应。 */
export type ConcurrencyWorkerResponse =
  | { kind: 'result'; result: CommandResult<unknown> }
  | { kind: 'fatal'; message: string }

/**
 * 判断是否为普通 JSON 对象。
 * @param value 任意值
 * @returns 是否为对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验 workerData 形状；非法返回 null。
 * @param value 原始 workerData
 * @returns 请求或 null
 */
function parseRequest(value: unknown): ConcurrencyWorkerRequest | null {
  if (!isRecord(value)) return null
  const { file, command, input, actor, idempotencyKey, expectedVersion } = value
  if (typeof file !== 'string' || typeof command !== 'string') return null
  if (typeof actor !== 'string' || typeof idempotencyKey !== 'string') return null
  if (!isRecord(input)) return null
  if (expectedVersion !== undefined && typeof expectedVersion !== 'number') return null
  return { file, command, input, actor, idempotencyKey, expectedVersion }
}

/**
 * 执行一次命令并回传结果。
 * @param request 工作线程请求
 * @returns 响应
 */
async function execute(request: ConcurrencyWorkerRequest): Promise<ConcurrencyWorkerResponse> {
  const db = openDatabase({ file: request.file })
  try {
    const registry = new CommandRegistry()
    registerCoreCommands(registry)
    const result = await dispatch(registry, request.command, request.input, {
      store: createLedgerStore(db),
      actor: request.actor,
      transport: 'cli',
      idempotencyKey: request.idempotencyKey,
      expectedVersion: request.expectedVersion,
    })
    return { kind: 'result', result }
  } finally {
    if (db.open) db.close()
  }
}

/**
 * 工作线程入口。
 * @returns 无返回值；结果经 postMessage 回传
 */
async function main(): Promise<void> {
  if (parentPort === null) throw new Error('concurrency-worker 必须作为 worker_threads 入口运行。')
  const request = parseRequest(workerData)
  if (request === null) {
    parentPort.postMessage({
      kind: 'fatal',
      message: '工作线程入参非法：需要 file/command/input/actor/idempotencyKey。',
    } satisfies ConcurrencyWorkerResponse)
    return
  }
  let response: ConcurrencyWorkerResponse
  try {
    response = await execute(request)
  } catch (error) {
    response = {
      kind: 'fatal',
      message: error instanceof Error ? error.message : String(error),
    }
  }
  parentPort.postMessage(response)
}

void main()
