/**
 * 只读模型路由：合同列表/详情、流水、交付、人员、字典、统计与提醒。
 * 派生字段全部来自 SQL 视图或 core 派生函数，接口不重复实现业务算法。
 */
import type { ContractStatusLogRow } from '@ledger/core'
import { deriveReminders, deriveStats } from '@ledger/core'
import { problemResponse } from '../http/problem.js'
import { nowMs, parsePositiveInt, todayIso } from '../http/util.js'
import type { AppOptions, LedgerApp } from '../types.js'
import {
  contractSorter,
  DEFAULT_PAGE_SIZE,
  listAllDeliveries,
  listAllPayments,
  MAX_PAGE_SIZE,
  readDirection,
  setVersionEtag,
  SORT_FIELDS,
} from './read-support.js'

/**
 * 注册只读路由。
 * @param app Hono 应用
 * @param options 应用配置
 */
export function registerReadRoutes(app: LedgerApp, options: AppOptions): void {
  app.get('/api/contracts', (c) => {
    const direction = readDirection(c.req.query('direction'))
    if (direction === null) {
      return problemResponse({
        code: 'VALIDATION_FAILED',
        message: 'direction 只能是 sale 或 purchase。',
        details: { fields: [{ path: 'direction', message: '取值非法' }] },
      })
    }
    const query: {
      direction?: 'sale' | 'purchase'
      statusCode?: string
      ownerId?: string
      search?: string
    } = {}
    if (direction !== undefined) query.direction = direction
    const status = c.req.query('status')
    if (status !== undefined && status !== '') query.statusCode = status
    const owner = c.req.query('owner')
    if (owner !== undefined && owner !== '') query.ownerId = owner
    const search = c.req.query('search')
    if (search !== undefined && search !== '') query.search = search

    const rows = options.store.contracts.list(query)
    const sortBy = c.req.query('sortBy')
    const sortOrder = c.req.query('sortOrder') === 'asc' ? 'asc' : 'desc'
    const field = sortBy !== undefined && SORT_FIELDS.has(sortBy) ? sortBy : 'updatedAt'
    const comparator = contractSorter(field)
    const sorted = [...rows].sort((a, b) => comparator(a, b) * (sortOrder === 'asc' ? 1 : -1))
    const page = parsePositiveInt(c.req.query('page')) ?? 1
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      parsePositiveInt(c.req.query('pageSize')) ?? DEFAULT_PAGE_SIZE,
    )
    const start = (page - 1) * pageSize
    setVersionEtag(c, options)
    return c.json({
      items: sorted.slice(start, start + pageSize),
      total: sorted.length,
      page,
      pageSize,
    })
  })

  app.get('/api/contracts/:id', (c) => {
    const id = c.req.param('id')
    const contract = options.store.contracts.getById(id)
    if (contract === null) {
      return problemResponse({ code: 'NOT_FOUND', message: `合同不存在：${id}`, details: { id } })
    }
    const payments = options.store.payments.listByContract(id)
    const deliveries = options.store.deliveries.listByContract(id)
    const statusLogs: ContractStatusLogRow[] = options.store.statusLogs.listByContract(id)
    setVersionEtag(c, options)
    return c.json({ contract, payments, deliveries, statusLogs })
  })

  app.get('/api/payments', (c) => {
    const contractId = c.req.query('contractId')
    const items =
      contractId === undefined || contractId === ''
        ? listAllPayments(options.db)
        : options.store.payments.listByContract(contractId)
    return c.json({ items })
  })

  app.get('/api/deliveries', (c) => {
    const contractId = c.req.query('contractId')
    const items =
      contractId === undefined || contractId === ''
        ? listAllDeliveries(options.db)
        : options.store.deliveries.listByContract(contractId)
    return c.json({ items })
  })

  app.get('/api/personnel', (c) => {
    const includeInactive = c.req.query('includeInactive') === 'true'
    return c.json({ items: options.store.personnel.list(includeInactive) })
  })

  app.get('/api/dicts', (c) => {
    const categoryCode = c.req.query('categoryCode')
    const items =
      categoryCode === undefined || categoryCode === ''
        ? options.store.dicts.listItems()
        : options.store.dicts.listItems(categoryCode)
    return c.json({ items, categories: options.store.dicts.listCategories() })
  })

  app.get('/api/stats', (c) => {
    const direction = readDirection(c.req.query('direction'))
    if (direction === null) {
      return problemResponse({
        code: 'VALIDATION_FAILED',
        message: 'direction 只能是 sale 或 purchase。',
        details: { fields: [{ path: 'direction', message: '取值非法' }] },
      })
    }
    const today = todayIso(nowMs(options.now))
    const contracts = options.store.contracts.list()
    const payments = listAllPayments(options.db)
    const stats = deriveStats(contracts, today, { payments })
    if (direction === undefined) {
      return c.json({ direction: 'all', stats })
    }
    return c.json({ direction, stats: stats[direction] })
  })

  app.get('/api/reminders', (c) => {
    const direction = readDirection(c.req.query('direction'))
    if (direction === null) {
      return problemResponse({
        code: 'VALIDATION_FAILED',
        message: 'direction 只能是 sale 或 purchase。',
        details: { fields: [{ path: 'direction', message: '取值非法' }] },
      })
    }
    const today = todayIso(nowMs(options.now))
    const contracts = options.store.contracts
      .list()
      .filter((contract) => direction === undefined || contract.direction === direction)
    const payments = listAllPayments(options.db)
    const reminders = deriveReminders(contracts, payments, today)
    return c.json({ direction: direction ?? 'all', reminders })
  })
}
