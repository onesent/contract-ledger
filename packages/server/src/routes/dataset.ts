/**
 * 数据集导出 / 导入路由。
 * 导出走 storage 的 sanitize（剔除 apiKey/baseUrl/ai.enabled）；导入单事务执行。
 */
import { exportDataset, importDataset } from '@ledger/storage-sqlite'
import { problemResponse } from '../http/problem.js'
import { isRecord, readJson } from '../http/util.js'
import type { AppOptions, LedgerApp } from '../types.js'

/** 导入模式。 */
type ImportMode = 'replace' | 'merge'

/**
 * 解析导入模式；非法值返回 null。
 * @param value 原始值
 * @returns 合法模式或 null
 */
function readMode(value: unknown): ImportMode | null {
  if (value === undefined || value === null || value === '') return 'replace'
  if (value === 'replace' || value === 'merge') return value
  return null
}

/**
 * 注册数据集路由。
 * @param app Hono 应用
 * @param options 应用配置
 */
export function registerDatasetRoutes(app: LedgerApp, options: AppOptions): void {
  app.get('/api/export', (c) => {
    const dataset = exportDataset(options.db)
    c.header('Content-Disposition', 'attachment; filename="ledger-export.json"')
    return c.json(dataset)
  })

  app.post('/api/import', async (c) => {
    if (options.readonly === true) {
      return problemResponse({
        code: 'READONLY',
        message: '当前服务处于只读模式，导入被拒绝；仍可导出备份。',
      })
    }
    const parsed = await readJson(c)
    if (!parsed.ok) return parsed.response
    if (!isRecord(parsed.value)) {
      return problemResponse({
        code: 'VALIDATION_FAILED',
        message: '导入请求体必须是 JSON 对象。',
      })
    }

    const hasDataset = Object.hasOwn(parsed.value, 'dataset')
    const payload = hasDataset ? parsed.value.dataset : parsed.value
    const rawMode = hasDataset ? parsed.value.mode : c.req.query('mode')
    const mode = readMode(rawMode)
    if (mode === null) {
      return problemResponse({
        code: 'VALIDATION_FAILED',
        message: 'mode 只能是 replace 或 merge。',
        details: { fields: [{ path: 'mode', message: '取值非法' }] },
      })
    }

    try {
      const report = importDataset(options.db, payload, {
        mode,
        actor: c.get('actor'),
      })
      return c.json({ ok: true, mode, report })
    } catch (error) {
      const message = error instanceof Error && error.message !== ''
        ? error.message
        : '导入失败：备份内容不合法。'
      return problemResponse({
        code: 'VALIDATION_FAILED',
        message,
      })
    }
  })
}
