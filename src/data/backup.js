import { APP_ID, SCHEMA_VERSION, normalizeSettings } from './schema'
import { applyChanges, countsOf, mergeDatasets, snapshot } from './store'
import { backupFileName, snapshotFileName } from '../utils/format'
import { nowIso } from '../utils/id'
import { validateBackup } from '../utils/validate'

/**
 * 备份 / 恢复：导出、导入前快照、结构校验、覆盖 / 合并写入。
 * 所有下载通过 Blob + <a download> 完成，不发起任何网络请求。
 */

/**
 * 剔除密钥类字段（API Key / Base URL），并关闭 AI 开关，避免密钥外泄。
 * @param {Object} settings
 * @returns {Object}
 */
export function sanitizeSettingsForBackup(settings) {
  const normalized = normalizeSettings(settings)
  const ai = { ...normalized.ai }
  delete ai.apiKey
  delete ai.baseUrl
  delete ai.enabled
  return { ...normalized, ai }
}

/**
 * 构造备份对象（含字典、人员、设置；不含 meta）。
 * @returns {Object}
 */
export function buildBackupPayload() {
  const snap = snapshot()
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    data: {
      contracts: snap.contracts,
      payments: snap.payments,
      personnel: snap.personnel,
      dicts: snap.dicts,
      settings: sanitizeSettingsForBackup(snap.settings),
    },
  }
}

/**
 * 触发浏览器下载（零网络请求）。
 * @param {string} fileName
 * @param {string} content
 */
export function downloadText(fileName, content) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }, 2000)
}

/**
 * 导出备份：下载 JSON 并更新 meta.lastBackupAt。
 * @returns {Promise<{ok:boolean, fileName:string, counts:Object, bytes:number, message?:string}>}
 */
export async function exportBackup() {
  const payload = buildBackupPayload()
  const text = JSON.stringify(payload, null, 2)
  const fileName = backupFileName()
  downloadText(fileName, text)
  const counts = countsOf({
    contracts: payload.data.contracts,
    payments: payload.data.payments,
    personnel: payload.data.personnel,
    dicts: payload.data.dicts,
  })
  const result = await applyChanges({
    put: { meta: { ...snapshot().meta, lastBackupAt: nowIso() } },
  })
  return {
    // 下载本身已成功：即使只读模式无法更新 meta，也不谎报导出失败
    ok: true,
    metaUpdated: result.ok,
    warning: result.ok ? '' : `备份已下载，但未能更新「上次备份时间」：${result.message}`,
    fileName,
    counts,
    bytes: new Blob([text]).size,
    message: result.ok ? '备份已导出并更新上次备份时间' : '备份已导出（未能更新上次备份时间）',
  }
}

/**
 * 下载导入前快照（结构与备份一致，文件名区分）。
 * @returns {Promise<{fileName:string, bytes:number}>}
 */
export async function downloadSnapshot() {
  const payload = buildBackupPayload()
  const text = JSON.stringify(payload, null, 2)
  const fileName = snapshotFileName()
  downloadText(fileName, text)
  return { fileName, bytes: new Blob([text]).size }
}

/**
 * 读取用户选择的备份文件文本。
 * @param {File} file
 * @returns {Promise<{ok:boolean, text?:string, message?:string}>}
 */
export function readFileText(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ ok: false, message: '未选择文件' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve({ ok: true, text: String(reader.result || '') })
    reader.onerror = () => resolve({ ok: false, message: `文件读取失败：${reader.error?.message || '未知错误'}` })
    reader.readAsText(file, 'utf-8')
  })
}

/**
 * 解析并校验备份文本。
 * @param {string} text
 * @returns {{ok:boolean, errors:string[], warnings:string[], counts:Object, payload:Object|null, message:string}}
 */
export function parseBackupText(text) {
  if (!text || !text.trim()) {
    return { ok: false, errors: ['文件内容为空'], warnings: [], counts: {}, payload: null, message: '文件内容为空' }
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      errors: [`JSON 解析失败：${err.message}`],
      warnings: [],
      counts: {},
      payload: null,
      message: `JSON 解析失败（文件可能被截断或不是合法 JSON）：${err.message}`,
    }
  }
  const validation = validateBackup(payload, { schemaVersion: SCHEMA_VERSION })
  return {
    ...validation,
    payload,
    message: validation.ok ? '备份文件校验通过' : `备份文件校验失败（${validation.errors.length} 项）`,
  }
}

/**
 * 导入备份（事务写入，失败整体回滚）。
 * @param {Object} payload 已通过结构校验的备份对象
 * @param {'overwrite'|'merge'} mode
 * @returns {Promise<{ok:boolean, mode:string, counts?:Object, message:string, code?:string, details?:Object}>}
 */
export async function importBackup(payload, mode) {
  const validation = validateBackup(payload, { schemaVersion: SCHEMA_VERSION })
  if (!validation.ok) {
    return { ok: false, mode, message: `备份文件校验失败：${validation.errors.slice(0, 5).join('；')}`, code: 'INVALID' }
  }
  if (mode !== 'overwrite' && mode !== 'merge') {
    return { ok: false, mode, message: '未知的导入模式', code: 'INVALID_MODE' }
  }

  const current = snapshot()
  const imported = {
    contracts: payload.data.contracts,
    payments: payload.data.payments,
    personnel: payload.data.personnel,
    dicts: payload.data.dicts,
    settings: payload.data.settings,
  }

  let next
  let details
  if (mode === 'overwrite') {
    next = {
      contracts: imported.contracts,
      payments: imported.payments,
      personnel: imported.personnel,
      dicts: imported.dicts,
      settings: normalizeSettings({
        ...imported.settings,
        // 覆盖时保留本机 AI 密钥，备份文件中不含密钥
        ai: { ...current.settings.ai, ...(imported.settings.ai || {}) },
      }),
      meta: {
        ...current.meta,
        seeded: true,
        lastImportAt: nowIso(),
      },
    }
    details = { added: imported.contracts.length, updated: 0, kept: 0 }
  } else {
    const merged = mergeDatasets(current, {
      ...imported,
      meta: { ...current.meta, seeded: true },
    })
    next = merged.dataset
    next.settings = normalizeSettings({
      ...next.settings,
      ai: { ...current.settings.ai, ...(next.settings.ai || {}) },
    })
    next.meta = {
      ...next.meta,
      seeded: true,
      lastImportAt: nowIso(),
      storageEngine: current.meta.storageEngine,
    }
    details = { added: merged.added, updated: merged.updated, kept: merged.kept }
  }

  const result = await applyChanges({ replace: next }, { touch: false })
  if (!result.ok) {
    return {
      ok: false,
      mode,
      code: result.code,
      message: `${result.message}（现有数据未受影响）`,
      details,
    }
  }
  return {
    ok: true,
    mode,
    counts: countsOf(next),
    details,
    message:
      mode === 'overwrite'
        ? '导入完成（覆盖模式），现有数据已整体替换'
        : `导入完成（合并模式）：新增 ${details.added} 条，更新 ${details.updated} 条，保留较新 ${details.kept} 条`,
  }
}
