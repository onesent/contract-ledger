/**
 * 本地台账服务的唯一 HTTP 出口。
 *
 * 约束（AGENTS.md / design.md D12）：
 * - 全应用只有本模块允许使用 fetch；组件与 composable 一律经此模块或 useLedger。
 * - 浏览器凭证走 HttpOnly 会话 Cookie（credentials: 'include'）；
 *   Cookie 写请求必须携带与 ledger_csrf Cookie 同值的 X-CSRF-Token 头（双提交）。
 * - 写命令必须携带 Idempotency-Key；相同键 + 相同内容重放首次结果。
 * - 错误统一抛 ApiError（status / code / message / hint / details / retryable），
 *   由调用方按 code 呈现，不解析 message 文本。
 */

/** CSRF 双提交 Cookie 名（服务端可读，配对时由服务签发）。 */
export const CSRF_COOKIE = 'ledger_csrf'

/** CSRF 请求头名（与服务端 http/cookies.ts 一致）。 */
export const CSRF_HEADER = 'X-CSRF-Token'

/** 业务错误 / 网络错误；code 为服务端稳定错误码，网络失败时为 NETWORK_ERROR。 */
export class ApiError extends Error {
  /**
   * @param {{status:number, code:string, message:string, hint?:string, details?:unknown, retryable?:boolean, requestId?:string}} init
   */
  constructor(init) {
    super(init.message)
    this.name = 'ApiError'
    /** HTTP 状态码；网络层失败为 0。 */
    this.status = init.status
    /** 稳定错误码（AUTH_REQUIRED / VALIDATION_FAILED / …）。 */
    this.code = init.code
    this.message = init.message
    /** 面向下一步操作的中文建议。 */
    this.hint = init.hint || ''
    this.details = init.details === undefined ? null : init.details
    this.retryable = init.retryable === true
    /** 401 标记：会话缺失 / 失效，路由据此引导配对页。 */
    this.isUnauthorized = init.status === 401
    this.requestId = init.requestId || ''
  }
}

/** 未认证回调（由 auth.js 注册；收到 401 时重置会话并跳转配对页）。 */
let unauthorizedHandler = null

/**
 * 注册 401 处理器。
 * @param {(error: ApiError) => void} [handler] 传 null 注销
 */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler || null
}

/**
 * 读取可读 Cookie（仅用于 CSRF 双提交值）。
 * @param {string} name Cookie 名
 * @returns {string} 值；不存在返回空串
 */
export function readCookie(name) {
  if (typeof document === 'undefined') return ''
  const prefix = `${name}=`
  for (const part of String(document.cookie || '').split(';')) {
    const cookie = part.trim()
    if (cookie.startsWith(prefix)) return decodeURIComponent(cookie.slice(prefix.length))
  }
  return ''
}

/**
 * 生成幂等键 / 请求号；crypto 缺失时退化为时间戳 + 随机数。
 * @returns {string}
 */
function newId() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* 非安全上下文不可用：走降级 */
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * 把非 2xx 响应映射为 ApiError（problem+json 字段优先）。
 * @param {Response} response fetch 响应
 * @param {unknown} payload 已解析的响应体
 * @returns {ApiError}
 */
function toApiError(response, payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const requestId =
    typeof body.meta === 'object' && body.meta !== null && typeof body.meta.requestId === 'string'
      ? body.meta.requestId
      : ''
  const message =
    typeof body.message === 'string' && body.message !== ''
      ? body.message
      : typeof body.detail === 'string' && body.detail !== ''
        ? body.detail
        : `请求失败（HTTP ${response.status}）。`
  return new ApiError({
    status: response.status,
    code: typeof body.code === 'string' ? body.code : `HTTP_${response.status}`,
    message,
    hint: typeof body.hint === 'string' ? body.hint : '',
    details: body.details === undefined ? null : body.details,
    retryable: body.retryable === true,
    requestId,
  })
}

/**
 * 解析响应体：JSON 优先，非法 JSON 保留原文。
 * @param {Response} response fetch 响应
 * @returns {Promise<unknown>}
 */
async function parseBody(response) {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 200) }
  }
}

/**
 * 发起一次 API 请求。
 * @param {string} path 以 /api 开头的路径
 * @param {Object} [options]
 * @param {string} [options.method] 默认 GET
 * @param {unknown} [options.body] JSON 请求体（GET 时忽略）
 * @param {Record<string, string|number|undefined|null>} [options.query] 查询参数（空值跳过）
 * @param {string} [options.requestId] 可选 X-Request-Id
 * @param {Record<string, string>} [options.headers] 附加请求头（如 Idempotency-Key）
 * @returns {Promise<unknown>} 解析后的 JSON
 * @throws {ApiError}
 */
export async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const url = new URL(path, typeof document !== 'undefined' ? document.baseURI : 'http://127.0.0.1/')
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  const headers = { Accept: 'application/json', ...(options.headers || {}) }
  if (method !== 'GET' && method !== 'HEAD') {
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf !== '') headers[CSRF_HEADER] = csrf
  }
  if (options.requestId) headers['X-Request-Id'] = options.requestId

  /** @type {RequestInit} */
  const init = { method, headers, credentials: 'include' }
  if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(options.body)
  }

  /** @type {Response} */
  let response
  try {
    response = await fetch(url.toString(), init)
  } catch (error) {
    const detail = error instanceof Error && error.message !== '' ? error.message : '本地服务不可访问'
    return Promise.reject(
      new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: `无法连接本地台账服务：${detail}。请确认服务已启动（node packages/server/dist/bin.js）。`,
        retryable: true,
      }),
    )
  }

  const payload = await parseBody(response)
  if (!response.ok) {
    const error = toApiError(response, payload)
    if (error.isUnauthorized && unauthorizedHandler !== null) unauthorizedHandler(error)
    throw error
  }
  return payload
}

/**
 * 调用一条领域命令：POST /api/commands/<name>，自动携带幂等键。
 * @param {string} name 点号命令名（如 contract.upsert）
 * @param {Object} input 命令入参（服务端 schema 的字段）
 * @returns {Promise<unknown>} 成功信封的 data
 * @throws {ApiError}
 */
export async function command(name, input) {
  const body = await request(`/api/commands/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: input,
    requestId: newId(),
    headers: { 'Idempotency-Key': newId() },
  })
  const envelope = body && typeof body === 'object' ? body : {}
  if (envelope.ok !== true) {
    throw new ApiError({
      status: 200,
      code: typeof envelope.code === 'string' ? envelope.code : 'INTERNAL',
      message: typeof envelope.message === 'string' ? envelope.message : '命令执行失败。',
      hint: typeof envelope.hint === 'string' ? envelope.hint : '',
      details: envelope.details === undefined ? null : envelope.details,
      retryable: envelope.retryable === true,
    })
  }
  return envelope.data
}

/** 生成新的幂等键（导出供测试与特殊场景使用）。 */
export const idempotencyKey = newId

// ---------- 认证 ----------

/** 读取当前会话（401 表示未配对 / 会话失效）。 */
export function getSession() {
  return request('/api/auth/session')
}

/**
 * 用一次性配对码换取浏览器会话。
 * @param {string} code 服务终端打印的配对码
 */
export function pair(code) {
  return request('/api/auth/pair', { method: 'POST', body: { code } })
}

/** 吊销当前会话并清理 Cookie。 */
export function logout() {
  return request('/api/auth/logout', { method: 'POST' })
}

// ---------- 只读模型 ----------

/** 健康检查（不含业务数据）。 */
export function getHealth() {
  return request('/api/health')
}

/**
 * 分页读取合同列表。
 * @param {{page?:number, pageSize?:number, direction?:string, status?:string, owner?:string, search?:string, sortBy?:string, sortOrder?:string}} [params]
 */
export function listContracts(params = {}) {
  return request('/api/contracts', { query: params })
}

/**
 * 读取合同详情（含资金流水、交付明细、状态日志）。
 * @param {string} id 合同 id
 */
export function getContract(id) {
  return request(`/api/contracts/${encodeURIComponent(id)}`)
}

/**
 * 读取人员列表。
 * @param {boolean} [includeInactive] 是否包含离职人员
 */
export function listPersonnel(includeInactive = true) {
  return request('/api/personnel', { query: { includeInactive: includeInactive ? 'true' : '' } })
}

/** 读取字典分类与字典项。 */
export function listDicts() {
  return request('/api/dicts')
}

/**
 * 读取统计（不带 direction 时返回 { sale, purchase } 全量）。
 * @param {string} [direction] sale / purchase
 */
export function getStats(direction) {
  return request('/api/stats', { query: { direction } })
}

/**
 * 读取提醒清单。
 * @param {string} [direction] sale / purchase
 */
export function getReminders(direction) {
  return request('/api/reminders', { query: { direction } })
}

/** 导出数据集（settings 已剔除密钥）。 */
export function exportDataset() {
  return request('/api/export')
}

/**
 * 导入数据集。
 * @param {{mode:'replace'|'merge', dataset:unknown}} payload 导入模式与备份内容
 */
export function importDataset(payload) {
  return request('/api/import', { method: 'POST', body: payload })
}

// ---------- 命令封装（入参为服务端字段，由 useLedger 完成映射） ----------

/**
 * 新增 / 更新合同。
 * @param {Object} input contract.upsert 入参
 */
export function saveContract(input) {
  return command('contract.upsert', input)
}

/**
 * 删除合同（级联流水与交付）。
 * @param {string} id 合同 id
 */
export function deleteContract(id) {
  return command('contract.delete', { id })
}

/**
 * 登记一笔资金流水。
 * @param {Object} input payment.record 入参
 */
export function recordPayment(input) {
  return command('payment.record', input)
}

/**
 * 删除一笔资金流水。
 * @param {string} id 流水 id
 */
export function deletePayment(id) {
  return command('payment.delete', { id })
}

/**
 * 登记一条交付明细。
 * @param {Object} input delivery.record 入参
 */
export function recordDelivery(input) {
  return command('delivery.record', input)
}

/**
 * 删除一条交付明细。
 * @param {string} id 明细 id
 */
export function deleteDelivery(id) {
  return command('delivery.delete', { id })
}

/**
 * 新增 / 更新人员档案。
 * @param {Object} input personnel.upsert 入参
 */
export function savePersonnel(input) {
  return command('personnel.upsert', input)
}

/**
 * 删除人员。
 * @param {string} id 人员 id
 */
export function deletePersonnel(id) {
  return command('personnel.delete', { id })
}

/**
 * 批量转交合同负责人。
 * @param {{fromId:string, toId:string}} input 转交参数
 */
export function transferPersonnel(input) {
  return command('personnel.transfer', input)
}

/**
 * 新增 / 更新字典分类或字典项。
 * @param {Object} input dict.upsert 入参（kind 判别）
 */
export function saveDict(input) {
  return command('dict.upsert', input)
}

/**
 * 删除字典分类或字典项。
 * @param {{kind:'category'|'item', id:string}} input 删除参数
 */
export function deleteDict(input) {
  return command('dict.delete', input)
}
