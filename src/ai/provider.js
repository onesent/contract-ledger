/**
 * AI 能力预留：全应用唯一的 AI 出口。
 *
 * 约束：
 * - 默认实现只返回统一的「未配置」占位结果：不抛异常、不阻塞主流程、不发任何网络请求。
 * - 业务组件只能调用本模块，禁止直接 fetch / XHR / WebSocket。
 * - 任何密钥都不写入源码、演示数据或备份文件。
 *
 * 接入真实模型三步：
 * 1. 在「设置 → AI 配置」填写服务商、Base URL、模型名、API Key 并打开总开关；
 * 2. 替换本文件 complete() 的实现，在函数内读取传入的 config 发起请求（注意超时与错误兜底）；
 * 3. 保持各业务方法（extractContract / summarize / draftReminder / askLedger）的返回结构不变。
 */

/** 服务商选项（设置页 el-select 使用，非业务下拉）。 */
export const AI_PROVIDERS = [
  { value: 'custom', label: '自定义（OpenAI 兼容）' },
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'local', label: '本地模型（占位）' },
]

/** AI 动作标识。 */
export const AI_ACTIONS = Object.freeze({
  EXTRACT: 'extractContract',
  SUMMARIZE: 'summarize',
  DRAFT_REMINDER: 'draftReminder',
  ASK_LEDGER: 'askLedger',
  COMPLETE: 'complete',
})

/**
 * 是否已配置可用（总开关 + Base URL + 模型 + API Key）。
 * @param {Object} config
 * @returns {boolean}
 */
export function isConfigured(config) {
  if (!config || config.enabled !== true) return false
  return Boolean(String(config.baseUrl || '').trim() && String(config.model || '').trim() && String(config.apiKey || '').trim())
}

/**
 * 统一的未配置占位结果。
 * @param {string} action
 * @param {unknown} [data]
 * @returns {Object}
 */
function notConfigured(action, data = null) {
  return {
    ok: false,
    configured: false,
    action,
    status: 'not-configured',
    message: 'AI 未配置：请在「设置 → AI 配置」中填写服务信息并打开总开关后使用。',
    data,
    meta: { network: false, at: new Date().toISOString() },
  }
}

/**
 * 统一占位结果（已配置但默认实现不请求网络）。
 * @param {string} action
 * @param {Object} config
 * @param {unknown} data
 * @returns {Object}
 */
function placeholder(action, config, data) {
  return {
    ok: false,
    configured: true,
    action,
    status: 'placeholder',
    message: '当前为 AI 占位实现（未接入真实模型），已返回空结果，不影响台账功能。',
    data,
    meta: {
      network: false,
      at: new Date().toISOString(),
      provider: config?.provider || 'custom',
      model: config?.model || '',
    },
  }
}

/**
 * 底层唯一出口。默认实现不发网络请求。
 * 未来接入真实模型时，只需在此处实现请求逻辑。
 * @param {string} prompt
 * @param {Object} [context]
 * @param {Object} [config]
 * @returns {Promise<Object>}
 */
export async function complete(prompt, context = {}, config = {}) {
  if (!isConfigured(config)) return notConfigured(AI_ACTIONS.COMPLETE)
  return placeholder(AI_ACTIONS.COMPLETE, config, {
    promptLength: String(prompt || '').length,
    contextKeys: Object.keys(context || {}),
    text: '',
  })
}

/**
 * 文本 → 合同字段草稿。
 * @param {string} text
 * @param {Object} [config]
 * @returns {Promise<Object>}
 */
export async function extractContract(text, config = {}) {
  if (!isConfigured(config)) return notConfigured(AI_ACTIONS.EXTRACT)
  if (!text || !String(text).trim()) {
    return {
      ok: false,
      configured: true,
      action: AI_ACTIONS.EXTRACT,
      status: 'empty-input',
      message: '请先粘贴合同文本。',
      data: null,
      meta: { network: false },
    }
  }
  const result = await complete(
    `请从以下文本提取合同字段（编号、客户、金额、签订日期、到期日、负责人）：\n${text}`,
    { schema: ['no', 'customer', 'amount', 'signDate', 'dueDate', 'ownerName'] },
    config,
  )
  return { ...result, action: AI_ACTIONS.EXTRACT, data: { fields: {}, missing: ['no', 'customer', 'amount', 'signDate', 'dueDate'] } }
}

/**
 * 合同摘要与风险点。
 * @param {Object} contract
 * @param {Object} [config]
 * @returns {Promise<Object>}
 */
export async function summarize(contract, config = {}) {
  if (!isConfigured(config)) return notConfigured(AI_ACTIONS.SUMMARIZE)
  const result = await complete(
    '请总结该合同的执行情况并列出风险点。',
    { contract },
    config,
  )
  return { ...result, action: AI_ACTIONS.SUMMARIZE, data: { summary: '', risks: [] } }
}

/**
 * 催收 / 续约文案。
 * @param {Object} contract
 * @param {Object} [config]
 * @returns {Promise<Object>}
 */
export async function draftReminder(contract, config = {}) {
  if (!isConfigured(config)) return notConfigured(AI_ACTIONS.DRAFT_REMINDER)
  const result = await complete(
    '请生成一封礼貌但明确的催收邮件，说明合同与未收金额。',
    { contract },
    config,
  )
  return { ...result, action: AI_ACTIONS.DRAFT_REMINDER, data: { subject: '', body: '' } }
}

/**
 * 自然语言 → 台账筛选条件。
 * @param {string} question
 * @param {Object} schema 可用的筛选字段说明
 * @param {Object} [config]
 * @returns {Promise<Object>}
 */
export async function askLedger(question, schema, config = {}) {
  if (!isConfigured(config)) return notConfigured(AI_ACTIONS.ASK_LEDGER)
  const result = await complete(
    `请把用户问题转换为台账筛选条件：${question}`,
    { schema },
    config,
  )
  return { ...result, action: AI_ACTIONS.ASK_LEDGER, data: { filters: null, explanation: '' } }
}

export default {
  AI_ACTIONS,
  AI_PROVIDERS,
  isConfigured,
  complete,
  extractContract,
  summarize,
  draftReminder,
  askLedger,
}
