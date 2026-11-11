import { reactive } from 'vue'
import {
  COLLECTIONS,
  SCHEMA_VERSION,
  createMeta,
  createSettings,
  emptyDataset,
  migrateDataset,
  normalizeMeta,
  normalizeSettings,
} from './schema'
import { nowIso } from '../utils/id'

/**
 * 存储层：全应用唯一的数据读写入口。
 * - IndexedDB：主引擎，单事务写入整库快照，导入失败整体回滚
 * - localStorage：降级引擎，仅适合小数据量，写满时明确失败并停止写入
 * - memory：只读兜底，所有写入返回失败，禁止谎报保存成功
 *
 * Vue 组件不得直接使用此模块，必须通过 composables/useLedger.js。
 */

export const ENGINE = Object.freeze({
  IDB: 'indexeddb',
  LS: 'localstorage',
  MEMORY: 'memory',
})

export const ENGINE_LABELS = Object.freeze({
  [ENGINE.IDB]: 'IndexedDB（主引擎）',
  [ENGINE.LS]: 'localStorage（降级）',
  [ENGINE.MEMORY]: '内存只读模式',
})

const DB_NAME = 'contract-ledger'
// 版本 2：新增 deliveries 对象仓库（需升级版本才会触发 onupgradeneeded 创建）
const DB_VERSION = 2
const LS_KEY = 'contract-ledger:dataset:v1'
const LS_CORRUPT_KEY = 'contract-ledger:dataset:corrupt'

/** 响应式数据缓存（视图直接消费，但写入必须走 applyChanges）。 */
export const data = reactive(emptyDataset())

/** 存储状态（引擎、可写性、错误、容量）。 */
export const status = reactive({
  ready: false,
  engine: ENGINE.MEMORY,
  writable: false,
  portable: typeof location !== 'undefined' && location.protocol === 'file:',
  idbAvailable: false,
  idbError: '',
  writeError: /** @type {null|{code:string,message:string}} */ (null),
  lastError: '',
  usage: /** @type {{bytes:number|null,quota:number|null,usage:number|null,source:string}} */ ({
    bytes: null,
    quota: null,
    usage: null,
    source: 'unknown',
  }),
  initializedAt: null,
})

/** @type {IDBDatabase|null} */
let db = null
/** @type {Set<(payload:Object)=>void>} */
const listeners = new Set()

/**
 * 订阅数据变化。
 * @param {(payload:Object)=>void} fn
 * @returns {() => void}
 */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * @param {Object} payload
 */
function emit(payload) {
  for (const fn of listeners) {
    try {
      fn(payload)
    } catch (err) {
      // 订阅方异常不应影响数据层
      void err
    }
  }
}

/**
 * 结构化深拷贝（保留纯数据结构）。
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepClone(value) {
  const c = typeof globalThis !== 'undefined' ? globalThis.structuredClone : undefined
  if (typeof c === 'function') {
    try {
      return c(value)
    } catch {
      /* 回退到 JSON 拷贝 */
    }
  }
  return JSON.parse(JSON.stringify(value))
}

/**
 * 打开 IndexedDB（带超时与同步异常保护）。
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('当前环境未提供 IndexedDB'))
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('打开 IndexedDB 超时（可能是隐私模式或浏览器限制）'))
    }, 4000)
    let request
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      clearTimeout(timer)
      reject(err)
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      for (const name of COLLECTIONS) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath: 'id' })
        }
      }
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      if (settled) {
        try {
          request.result.close()
        } catch {
          /* ignore */
        }
        return
      }
      settled = true
      resolve(request.result)
    }
    request.onerror = () => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      reject(request.error || new Error('IndexedDB 打开失败'))
    }
    request.onblocked = () => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      reject(new Error('IndexedDB 被其他页面占用，请关闭其他标签页后重试'))
    }
  })
}

/**
 * 读取 IndexedDB 全量数据。
 * @param {IDBDatabase} database
 * @returns {Promise<Object>}
 */
async function readIdb(database) {
  const result = emptyDataset()
  await new Promise((resolve, reject) => {
    let tx
    try {
      tx = database.transaction(COLLECTIONS, 'readonly')
    } catch (err) {
      reject(err)
      return
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('读取 IndexedDB 失败'))
    tx.onabort = () => reject(tx.error || new Error('读取 IndexedDB 被中止'))
    for (const name of COLLECTIONS) {
      const request = tx.objectStore(name).getAll()
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? request.result : []
        if (name === 'settings') result.settings = rows.find((r) => r.id === 'app') || createSettings()
        else if (name === 'meta') result.meta = rows.find((r) => r.id === 'meta') || createMeta()
        else result[name] = rows
      }
    }
  })
  return result
}

/**
 * 用单个事务写入整库（原子提交，失败整体回滚）。
 * @param {IDBDatabase} database
 * @param {Object} dataset
 * @returns {Promise<void>}
 */
async function writeIdb(database, dataset) {
  await new Promise((resolve, reject) => {
    let tx
    try {
      tx = database.transaction(COLLECTIONS, 'readwrite')
    } catch (err) {
      reject(err)
      return
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('写入 IndexedDB 失败'))
    tx.onabort = () => reject(tx.error || new Error('写入 IndexedDB 被中止（已回滚）'))
    try {
      for (const name of COLLECTIONS) {
        const objectStore = tx.objectStore(name)
        objectStore.clear()
        if (name === 'settings') objectStore.put(dataset.settings || createSettings())
        else if (name === 'meta') objectStore.put(dataset.meta || createMeta())
        else for (const record of dataset[name] || []) objectStore.put(record)
      }
    } catch (err) {
      try {
        tx.abort()
      } catch {
        /* ignore */
      }
      reject(err)
    }
  })
}

/**
 * 探测 localStorage 是否可用（隐私模式 / 禁用 Cookie 时会抛 SecurityError）。
 * @returns {boolean}
 */
function canUseLocalStorage() {
  try {
    const key = 'contract-ledger:probe'
    localStorage.setItem(key, '1')
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * 读取 localStorage 数据集。
 * @returns {Object|null}
 */
function readLs() {
  const raw = localStorage.getItem(LS_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('数据集不是对象')
    return parsed
  } catch (err) {
    // 保留损坏原文，避免静默覆盖用户数据
    try {
      localStorage.setItem(LS_CORRUPT_KEY, raw)
    } catch {
      /* ignore */
    }
    status.lastError = `localStorage 中的数据无法解析：${err.message}。原始内容已另存到 ${LS_CORRUPT_KEY}`
    return null
  }
}

/**
 * 写入 localStorage（单键整库写入；空间不足时抛出 QuotaExceededError）。
 * @param {Object} dataset
 */
function writeLs(dataset) {
  const payload = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    savedAt: nowIso(),
    ...dataset,
  })
  try {
    localStorage.setItem(LS_KEY, payload)
  } catch (err) {
    throw err
  }
}

/**
 * 计算容量信息。
 * @param {Object} dataset
 * @returns {Promise<Object>}
 */
async function estimateUsage(dataset) {
  let bytes = null
  try {
    bytes = new Blob([JSON.stringify(dataset)]).size
  } catch {
    bytes = JSON.stringify(dataset).length
  }
  let usage = null
  let quota = null
  let source = 'dataset'
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const estimate = await navigator.storage.estimate()
      usage = Number.isFinite(estimate.usage) ? estimate.usage : null
      quota = Number.isFinite(estimate.quota) ? estimate.quota : null
      source = 'storage.estimate'
    } catch {
      /* 部分浏览器拒绝 estimate，使用数据体积兜底 */
    }
  }
  return { bytes, usage, quota, source }
}

/**
 * 规范化写入错误，区分配额不足 / 安全限制 / 只读。
 * @param {unknown} err
 * @returns {{code:string, message:string}}
 */
function normalizeWriteError(err) {
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : ''
  const raw = err && err.message ? String(err.message) : String(err || '未知错误')
  if (name === 'QuotaExceededError' || /quota/i.test(raw)) {
    return {
      code: 'QUOTA',
      message: '浏览器存储配额已满，写入失败。已停止继续录入，请立即导出备份并清理部分数据后重试。',
    }
  }
  if (name === 'SecurityError') {
    return {
      code: 'SECURITY',
      message: '浏览器拒绝了本地存储写入（可能是隐私模式 / 站点数据被禁用）。已停止写入，请导出备份后更换浏览器环境。',
    }
  }
  return { code: 'WRITE_FAILED', message: `写入本地存储失败：${raw}` }
}

/**
 * @param {Object} dataset
 * @returns {{contracts:number,payments:number,deliveries:number,personnel:number,dicts:number}}
 */
export function countsOf(dataset = data) {
  return {
    contracts: Array.isArray(dataset.contracts) ? dataset.contracts.length : 0,
    payments: Array.isArray(dataset.payments) ? dataset.payments.length : 0,
    deliveries: Array.isArray(dataset.deliveries) ? dataset.deliveries.length : 0,
    personnel: Array.isArray(dataset.personnel) ? dataset.personnel.length : 0,
    dicts: Array.isArray(dataset.dicts) ? dataset.dicts.length : 0,
  }
}

/**
 * 克隆数据集（不共享引用）。
 * @param {Object} source
 * @returns {Object}
 */
export function cloneDataset(source) {
  const base = source || emptyDataset()
  return {
    contracts: deepClone(Array.isArray(base.contracts) ? base.contracts : []),
    payments: deepClone(Array.isArray(base.payments) ? base.payments : []),
    deliveries: deepClone(Array.isArray(base.deliveries) ? base.deliveries : []),
    personnel: deepClone(Array.isArray(base.personnel) ? base.personnel : []),
    dicts: deepClone(Array.isArray(base.dicts) ? base.dicts : []),
    settings: deepClone(normalizeSettings(base.settings)),
    meta: deepClone(normalizeMeta(base.meta)),
  }
}

/**
 * 将变更应用到数据集副本。
 * @param {Object} base
 * @param {{replace?:Object, put?:Object<string,any>, remove?:Object<string,string[]>}} changes
 * @param {{touch?:boolean}} [options]
 * @returns {Object}
 */
function mergeChanges(base, changes, options = {}) {
  const touch = options.touch !== false
  let next = cloneDataset(changes.replace ? changes.replace : base)
  const remove = changes.remove || {}
  for (const [name, ids] of Object.entries(remove)) {
    if (name === 'settings' || name === 'meta') continue
    const set = new Set(ids || [])
    next[name] = (next[name] || []).filter((record) => !set.has(record.id))
  }
  const put = changes.put || {}
  for (const [name, value] of Object.entries(put)) {
    if (value === undefined || value === null) continue
    if (name === 'settings') {
      const normalized = normalizeSettings(value)
      next.settings = touch ? { ...normalized, updatedAt: nowIso() } : normalized
      continue
    }
    if (name === 'meta') {
      const normalized = normalizeMeta(value)
      next.meta = touch ? { ...normalized, updatedAt: nowIso() } : normalized
      continue
    }
    const list = Array.isArray(value) ? value : [value]
    const map = new Map((next[name] || []).map((record) => [record.id, record]))
    for (const record of list) {
      if (!record || !record.id) continue
      const previous = map.get(record.id)
      if (touch) {
        map.set(record.id, {
          ...record,
          createdAt: record.createdAt || previous?.createdAt || nowIso(),
          updatedAt: nowIso(),
        })
      } else {
        map.set(record.id, { ...record })
      }
    }
    next[name] = [...map.values()]
  }
  return next
}

/**
 * 写入存储引擎（成功后不更新缓存，由调用方赋值）。
 * @param {Object} next
 * @returns {Promise<void>}
 */
async function persist(next) {
  if (status.engine === ENGINE.IDB) {
    if (!db) throw new Error('IndexedDB 连接已断开，请重新检测存储')
    await writeIdb(db, next)
    return
  }
  if (status.engine === ENGINE.LS) {
    writeLs(next)
    return
  }
  const err = new Error('当前为内存只读模式')
  err.name = 'ReadOnlyError'
  throw err
}

/**
 * 应用一组原子变更：成功后才更新内存缓存并广播。
 * @param {{replace?:Object, put?:Object<string,any>, remove?:Object<string,string[]>}} changes
 * @param {{touch?:boolean}} [options]
 * @returns {Promise<{ok:boolean, code?:string, message?:string, counts?:Object}>}
 */
export async function applyChanges(changes, options = {}) {
  if (!status.ready) {
    return { ok: false, code: 'NOT_READY', message: '存储尚未初始化完成，请稍后重试' }
  }
  if (!status.writable) {
    return {
      ok: false,
      code: 'READONLY',
      message: status.writeError?.message || '当前为只读模式，无法保存。请导出备份后更换使用方式。',
    }
  }
  const next = mergeChanges(data, changes, options)
  // 写入前统一深拷贝：Vue 响应式 Proxy 无法被 IndexedDB 结构化克隆
  const plain = cloneDataset(next)
  try {
    await persist(plain)
  } catch (err) {
    const info = normalizeWriteError(err)
    status.writeError = info
    status.lastError = info.message
    if (info.code === 'QUOTA' || info.code === 'SECURITY') {
      status.writable = false
    }
    emit({ type: 'error', error: info })
    return { ok: false, ...info }
  }
  Object.assign(data, plain)
  status.writeError = null
  status.usage = await estimateUsage(plain)
  emit({ type: 'change', changes })
  return { ok: true, counts: countsOf(plain) }
}

/**
 * 初始化存储：IndexedDB → localStorage → 内存只读。
 * @returns {Promise<{engine:string, writable:boolean, message:string}>}
 */
export async function init() {
  status.ready = false
  status.writeError = null
  status.lastError = ''
  status.idbError = ''
  status.idbAvailable = false

  /** @type {Object|null} */
  let dataset = null
  /** @type {string} */
  let bootstrapMessage = ''

  /** @type {string} */
  let migrationNotice = ''

  // 1) 尝试 IndexedDB
  try {
    db = await openDb()
    status.engine = ENGINE.IDB
    status.idbAvailable = true
    status.writable = true
    dataset = await readIdb(db)

    // 引擎恢复可用时：把 localStorage 中遗留的历史数据合并进 IndexedDB（按 id 去重，updatedAt 较新者优先）
    let lsRaw = null
    try {
      lsRaw = localStorage.getItem(LS_KEY)
    } catch {
      lsRaw = null
    }
    if (lsRaw) {
      try {
        const normalized = migrateDataset(JSON.parse(lsRaw)).dataset
        const hasBusinessData = ['contracts', 'payments', 'personnel', 'dicts'].some(
          (name) => Array.isArray(normalized[name]) && normalized[name].length > 0,
        )
        if (hasBusinessData) {
          const before = countsOf(dataset)
          const merged = mergeDatasets(dataset, normalized)
          dataset = merged.dataset
          dataset.meta.seeded = true
          dataset.meta.storageEngine = ENGINE.IDB
          dataset.meta.lastMigrationAt = nowIso()
          migrationNotice = `检测到 localStorage 中的历史数据，已迁移到 IndexedDB（新增 ${merged.added} 条、更新 ${merged.updated} 条、保留较新 ${merged.kept} 条；合同 ${before.contracts} → ${dataset.contracts.length}、收款 ${before.payments} → ${dataset.payments.length}）。`
        }
      } catch (lsError) {
        status.lastError = `localStorage 历史数据迁移失败：${lsError.message}，原数据仍保留在 localStorage 中。`
      }
    }
  } catch (idbError) {
    db = null
    status.idbError = idbError?.message || String(idbError)
    status.idbAvailable = false

    // 2) 降级到 localStorage
    if (canUseLocalStorage()) {
      status.engine = ENGINE.LS
      status.writable = true
      try {
        dataset = readLs() || emptyDataset()
        bootstrapMessage = 'IndexedDB 不可用，已降级为 localStorage（仅适合小数据量）。'
      } catch (lsError) {
        status.engine = ENGINE.MEMORY
        status.writable = false
        dataset = emptyDataset()
        status.lastError = `localStorage 读取失败：${lsError.message}`
        bootstrapMessage = '存储不可用，已进入内存只读模式。'
      }
    } else {
      // 3) 内存只读
      status.engine = ENGINE.MEMORY
      status.writable = false
      dataset = emptyDataset()
      bootstrapMessage = '浏览器禁用了 IndexedDB 与 localStorage，已进入内存只读模式（仅可浏览与导出）。'
    }
  }

  const migrated = migrateDataset(dataset || emptyDataset())
  const next = migrated.dataset
  next.meta.storageEngine = status.engine
  Object.assign(data, next)

  // 首次创建 / 迁移后落盘，保证 settings、meta 记录存在
  try {
    if (status.engine === ENGINE.IDB && db) {
      await writeIdb(db, cloneDataset(data))
    } else if (status.engine === ENGINE.LS) {
      writeLs(cloneDataset(data))
    }
  } catch (err) {
    const info = normalizeWriteError(err)
    status.writeError = info
    status.lastError = info.message
    if (info.code === 'QUOTA' || info.code === 'SECURITY') status.writable = false
    migrationNotice = ''
  }

  // 迁移写入成功后才清理 localStorage 副本，失败时保留原数据
  if (migrationNotice && status.engine === ENGINE.IDB && !status.writeError) {
    try {
      localStorage.removeItem(LS_KEY)
    } catch {
      /* ignore */
    }
  }

  status.usage = await estimateUsage(cloneDataset(data))
  status.ready = true
  status.initializedAt = nowIso()
  emit({ type: 'init', engine: status.engine })

  if (migrated.changed) {
    bootstrapMessage = `数据结构已从 v${migrated.fromVersion || '未知'} 迁移到 v${SCHEMA_VERSION}。${bootstrapMessage}`
  }
  if (migrationNotice) {
    bootstrapMessage = `${migrationNotice}${bootstrapMessage}`
  }
  return { engine: status.engine, writable: status.writable, message: bootstrapMessage }
}

/**
 * 获取当前数据集副本（导出用）。
 * @returns {Object}
 */
export function snapshot() {
  return cloneDataset(data)
}

/**
 * 容量刷新。
 * @returns {Promise<Object>}
 */
export async function refreshUsage() {
  status.usage = await estimateUsage(data)
  return status.usage
}

/**
 * 重试写入：用于配额/安全错误后的自检恢复。
 * @returns {Promise<{ok:boolean, message:string, code?:string}>}
 */
export async function retryWrite() {
  if (status.engine === ENGINE.MEMORY) {
    return { ok: false, code: 'READONLY', message: '当前为内存只读模式，无法写入。' }
  }
  try {
    await persist(cloneDataset(data))
    status.writeError = null
    status.writable = true
    status.usage = await estimateUsage(data)
    emit({ type: 'retry-success' })
    return { ok: true, message: '写入恢复正常。' }
  } catch (err) {
    const info = normalizeWriteError(err)
    status.writeError = info
    status.lastError = info.message
    return { ok: false, ...info }
  }
}

/**
 * 合并两份数据集：按 id 去重，updatedAt 较新者优先。
 * @param {Object} base
 * @param {Object} incoming
 * @returns {{dataset:Object, added:number, updated:number, kept:number}}
 */
export function mergeDatasets(base, incoming) {
  const out = cloneDataset(base)
  let added = 0
  let updated = 0
  let kept = 0
  for (const name of ['contracts', 'payments', 'deliveries', 'personnel', 'dicts']) {
    const map = new Map((out[name] || []).map((record) => [record.id, record]))
    for (const record of incoming[name] || []) {
      const previous = map.get(record.id)
      if (!previous) {
        map.set(record.id, { ...record })
        added += 1
      } else if (new Date(record.updatedAt || 0).getTime() > new Date(previous.updatedAt || 0).getTime()) {
        map.set(record.id, { ...record })
        updated += 1
      } else {
        kept += 1
      }
    }
    out[name] = [...map.values()]
  }
  out.settings = normalizeSettings({ ...out.settings, ...incoming.settings })
  out.meta = normalizeMeta({
    ...out.meta,
    seeded: out.meta.seeded || incoming.meta?.seeded || out.contracts.length > 0,
    lastMigrationAt: nowIso(),
    storageEngine: ENGINE.IDB,
  })
  return { dataset: out, added, updated, kept }
}

/**
 * 重新检测 IndexedDB；恢复可用时按 id 去重迁移当前数据（禁止双份数据互相覆盖）。
 * @returns {Promise<Object>}
 */
export async function recheckStorage() {
  if (status.engine === ENGINE.IDB) {
    const retry = await retryWrite()
    return {
      ok: retry.ok,
      engine: status.engine,
      message: retry.ok ? 'IndexedDB 写入正常。' : retry.message,
    }
  }
  let nextDb
  try {
    nextDb = await openDb()
  } catch (err) {
    status.idbError = err?.message || String(err)
    return {
      ok: false,
      engine: status.engine,
      message: `IndexedDB 仍不可用：${status.idbError}`,
    }
  }
  try {
    const existing = await readIdb(nextDb)
    const before = countsOf(data)
    const { dataset: merged, added, updated, kept } = mergeDatasets(existing, cloneDataset(data))
    merged.meta.storageEngine = ENGINE.IDB
    merged.meta.lastMigrationAt = nowIso()
    await writeIdb(nextDb, merged)
    if (db && db !== nextDb) {
      try {
        db.close()
      } catch {
        /* ignore */
      }
    }
    db = nextDb
    Object.assign(data, merged)
    status.engine = ENGINE.IDB
    status.writable = true
    status.idbAvailable = true
    status.idbError = ''
    status.writeError = null
    status.usage = await estimateUsage(merged)
    try {
      localStorage.removeItem(LS_KEY)
    } catch {
      /* ignore */
    }
    emit({ type: 'migrated', engine: ENGINE.IDB })
    return {
      ok: true,
      engine: ENGINE.IDB,
      before,
      after: countsOf(merged),
      added,
      updated,
      kept,
      message: `已迁移到 IndexedDB：新增 ${added} 条、更新 ${updated} 条、保留较新 ${kept} 条。`,
    }
  } catch (err) {
    try {
      nextDb.close()
    } catch {
      /* ignore */
    }
    const info = normalizeWriteError(err)
    status.lastError = info.message
    return { ok: false, engine: status.engine, message: info.message, code: info.code }
  }
}

/**
 * 刷新 data.meta.storageEngine 后落盘（初始化/迁移后调用）。
 * @returns {Promise<void>}
 */
export async function persistMetaEngine() {
  if (!status.writable) return
  try {
    await applyChanges({ put: { meta: { ...data.meta, storageEngine: status.engine } } })
  } catch {
    /* 忽略：引擎状态写入失败不阻塞主流程 */
  }
}
