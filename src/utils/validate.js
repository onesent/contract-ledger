import dayjs from 'dayjs'
import { APP_ID, SCHEMA_VERSION } from '../data/schema'
import { isFiniteNumber, roundMoney } from './format'

/**
 * 是否为空值（字符串仅含空白视为空）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * 是否为严格的 YYYY-MM-DD 日期字符串。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return dayjs(value).isValid()
}

/**
 * 是否为带时间的时间戳字符串（可被 dayjs 解析）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && dayjs(value).isValid()
}

/**
 * 小数位是否不超过指定精度。
 * @param {number} value
 * @param {number} precision
 * @returns {boolean}
 */
export function hasValidPrecision(value, precision) {
  const parts = String(Number(value)).split('.')
  return !parts[1] || parts[1].length <= precision
}

/**
 * 必填校验器工厂。
 * @param {string} [label]
 * @returns {(rule:Object, value:unknown, callback:Function)=>void}
 */
export function requiredValidator(label = '该字段') {
  return (_rule, value, callback) => {
    if (isBlank(value)) callback(new Error(`${label}不能为空`))
    else callback()
  }
}

/**
 * 合同表单校验规则（含唯一性、金额逻辑、日期先后）。
 * @param {Object} ctx
 * @param {Array<Object>} ctx.contracts
 * @param {string} [ctx.currentId]
 * @param {number} [ctx.precision]
 * @param {() => Object} ctx.getValues 取当前表单值（用于跨字段校验）
 * @returns {Object}
 */
export function contractRules({ contracts = [], currentId = '', precision = 2, getValues = () => ({}) }) {
  const duplicatedNo = (value, selfId) => {
    const target = String(value || '').trim().toLowerCase()
    if (!target) return null
    return contracts.find((c) => c.id !== selfId && String(c.no || '').trim().toLowerCase() === target) || null
  }

  return {
    no: [
      { required: true, message: '合同编号不能为空', trigger: 'blur' },
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback()
          const duplicate = duplicatedNo(value, currentId)
          if (duplicate) return callback(new Error(`合同编号已存在：${duplicate.customer}`))
          if (String(value).trim().length > 40) return callback(new Error('合同编号不能超过 40 个字符'))
          callback()
        },
        trigger: 'blur',
      },
    ],
    customer: [
      { required: true, message: '客户名称不能为空', trigger: 'blur' },
      { max: 80, message: '客户名称不能超过 80 个字符', trigger: 'blur' },
    ],
    typeCode: [{ required: true, message: '请选择合同类型', trigger: 'change' }],
    amount: [
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback(new Error('合同金额不能为空'))
          if (!isFiniteNumber(value)) return callback(new Error('合同金额必须是数字'))
          if (Number(value) < 0) return callback(new Error('合同金额不能小于 0'))
          if (!hasValidPrecision(value, precision)) {
            return callback(new Error(`合同金额最多支持 ${precision} 位小数`))
          }
          callback()
        },
        trigger: 'change',
      },
    ],
    receivedAmount: [
      {
        validator: (_rule, value, callback) => {
          const values = getValues() || {}
          const amount = Number(values.amount)
          if (isBlank(value)) return callback(new Error('已收金额不能为空'))
          if (!isFiniteNumber(value)) return callback(new Error('已收金额必须是数字'))
          if (Number(value) < 0) return callback(new Error('已收金额不能小于 0'))
          if (!hasValidPrecision(value, precision)) {
            return callback(new Error(`已收金额最多支持 ${precision} 位小数`))
          }
          if (isFiniteNumber(amount) && Number(value) > amount) {
            return callback(new Error('已收金额不能大于合同金额'))
          }
          callback()
        },
        trigger: 'change',
      },
    ],
    signDate: [{ required: true, message: '请选择签订日期', trigger: 'change' }],
    startDate: [
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback()
          if (!isDateString(value)) return callback(new Error('开始日期格式应为 YYYY-MM-DD'))
          callback()
        },
        trigger: 'change',
      },
    ],
    dueDate: [
      { required: true, message: '请选择到期日', trigger: 'change' },
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback()
          if (!isDateString(value)) return callback(new Error('到期日格式应为 YYYY-MM-DD'))
          const values = getValues() || {}
          const start = values.startDate || values.signDate
          if (start && dayjs(value).isBefore(dayjs(start))) {
            return callback(new Error('到期日不能早于开始日期'))
          }
          callback()
        },
        trigger: 'change',
      },
    ],
    statusCode: [{ required: true, message: '请选择合同状态', trigger: 'change' }],
    ownerId: [{ required: true, message: '请选择负责人', trigger: 'change' }],
    note: [{ max: 500, message: '备注不能超过 500 个字符', trigger: 'blur' }],
  }
}

/**
 * 收款登记校验规则。
 * @param {Object} ctx
 * @param {() => number} ctx.getMax 可收上限（合同金额 − 已收金额）
 * @param {number} [ctx.precision]
 * @returns {Object}
 */
export function paymentRules({ getMax = () => Number.POSITIVE_INFINITY, precision = 2 }) {
  return {
    amount: [
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback(new Error('收款金额不能为空'))
          if (!isFiniteNumber(value)) return callback(new Error('收款金额必须是数字'))
          if (Number(value) <= 0) return callback(new Error('收款金额必须大于 0'))
          if (!hasValidPrecision(value, precision)) {
            return callback(new Error(`收款金额最多支持 ${precision} 位小数`))
          }
          const max = Number(getMax())
          if (Number.isFinite(max) && Number(value) > roundMoney(max, precision) + 1e-9) {
            return callback(new Error(`本次收款不能超过剩余未收金额 ${roundMoney(max, precision)} 元`))
          }
          callback()
        },
        trigger: 'change',
      },
    ],
    date: [{ required: true, message: '请选择收款日期', trigger: 'change' }],
    methodCode: [{ required: true, message: '请选择付款方式', trigger: 'change' }],
    note: [{ max: 200, message: '备注不能超过 200 个字符', trigger: 'blur' }],
  }
}

/**
 * 人员表单校验规则。
 * @param {Object} ctx
 * @param {Array<Object>} ctx.personnel
 * @param {string} [ctx.currentId]
 * @returns {Object}
 */
export function personnelRules({ personnel = [], currentId = '' }) {
  const duplicated = (field, label) => (_rule, value, callback) => {
    if (isBlank(value)) return callback()
    const target = String(value).trim().toLowerCase()
    const hit = personnel.find((p) => p.id !== currentId && String(p[field] || '').trim().toLowerCase() === target)
    if (hit) return callback(new Error(`${label}已存在：${hit.name}`))
    callback()
  }
  return {
    code: [
      { required: true, message: '人员编号不能为空', trigger: 'blur' },
      { validator: duplicated('code', '人员编号'), trigger: 'blur' },
    ],
    name: [
      { required: true, message: '姓名不能为空', trigger: 'blur' },
      { max: 30, message: '姓名不能超过 30 个字符', trigger: 'blur' },
    ],
    deptCode: [{ required: true, message: '请选择部门', trigger: 'change' }],
    phone: [
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback()
          if (!/^1[3-9]\d{9}$/.test(String(value).trim())) return callback(new Error('请输入 11 位手机号'))
          callback()
        },
        trigger: 'blur',
      },
    ],
    email: [
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback()
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())) {
            return callback(new Error('请输入合法的邮箱地址'))
          }
          callback()
        },
        trigger: 'blur',
      },
    ],
    hireDate: [
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback()
          if (!isDateString(value)) return callback(new Error('入职日期格式应为 YYYY-MM-DD'))
          callback()
        },
        trigger: 'change',
      },
    ],
  }
}

/**
 * 字典项校验规则。
 * @param {Object} ctx
 * @param {Array<Object>} ctx.dicts
 * @param {string} ctx.category
 * @param {string} [ctx.currentId]
 * @returns {Object}
 */
export function dictRules({ dicts = [], category = '', currentId = '' }) {
  return {
    code: [
      { required: true, message: '编码不能为空', trigger: 'blur' },
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback()
          if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(value).trim())) {
            return callback(new Error('编码仅支持字母、数字、下划线和短横线，长度 1-40'))
          }
          const hit = dicts.find(
            (d) =>
              d.id !== currentId &&
              d.category === category &&
              String(d.code).toLowerCase() === String(value).trim().toLowerCase(),
          )
          if (hit) return callback(new Error(`当前分类下已存在编码：${hit.code}`))
          callback()
        },
        trigger: 'blur',
      },
    ],
    name: [
      { required: true, message: '名称不能为空', trigger: 'blur' },
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback()
          const hit = dicts.find(
            (d) =>
              d.id !== currentId &&
              d.category === category &&
              String(d.name).trim().toLowerCase() === String(value).trim().toLowerCase(),
          )
          if (hit) return callback(new Error(`当前分类下已存在同名项：${hit.name}`))
          callback()
        },
        trigger: 'blur',
      },
    ],
    color: [{ required: true, message: '请选择颜色标签', trigger: 'change' }],
    sort: [{ required: true, message: '请输入排序值', trigger: 'change' }],
  }
}

/**
 * @typedef {Object} BackupValidationResult
 * @property {boolean} ok
 * @property {string[]} errors
 * @property {string[]} warnings
 * @property {Object<string, number>} counts
 */

/**
 * 备份文件结构与字段校验（不修改入参）。
 * @param {unknown} payload
 * @param {{schemaVersion?:number}} [options]
 * @returns {BackupValidationResult}
 */
export function validateBackup(payload, options = {}) {
  const currentVersion = options.schemaVersion || SCHEMA_VERSION
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []
  /** @type {Object<string, number>} */
  const counts = { contracts: 0, payments: 0, personnel: 0, dicts: 0 }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['文件内容不是合法的 JSON 对象'], warnings, counts }
  }
  if (payload.app !== APP_ID) {
    errors.push(`应用标识不匹配：期望 "${APP_ID}"，实际 "${String(payload.app)}"`)
  }
  const version = payload.schemaVersion
  if (!Number.isInteger(version)) {
    errors.push('缺少合法的 schemaVersion（应为整数）')
  } else if (version > currentVersion) {
    errors.push(`备份版本 ${version} 高于当前应用支持版本 ${currentVersion}，请升级应用后再导入`)
  } else if (version < 1) {
    errors.push(`备份版本 ${version} 非法`)
  }
  if (!payload.exportedAt || !isTimestamp(payload.exportedAt)) {
    warnings.push('备份文件缺少导出时间 exportedAt，仍可尝试导入')
  }
  const data = payload.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('缺少 data 对象')
    return { ok: false, errors, warnings, counts }
  }

  const requireArray = (name, label) => {
    if (!Array.isArray(data[name])) {
      errors.push(`data.${name} 应为数组（${label}）`)
      return []
    }
    counts[name] = data[name].length
    return data[name]
  }

  // ---- 合同 ----
  const contracts = requireArray('contracts', '合同')
  const contractIds = new Set()
  contracts.forEach((c, i) => {
    const path = `contracts[${i}]`
    if (!c || typeof c !== 'object') return errors.push(`${path} 不是合法对象`)
    if (isBlank(c.id)) errors.push(`${path}.id 缺失`)
    else if (contractIds.has(c.id)) errors.push(`${path}.id 重复：${c.id}`)
    else contractIds.add(c.id)
    if (isBlank(c.no)) errors.push(`${path}.no 合同编号缺失`)
    if (isBlank(c.customer)) errors.push(`${path}.customer 客户名称缺失`)
    if (isBlank(c.typeCode)) errors.push(`${path}.typeCode 合同类型缺失`)
    if (isBlank(c.statusCode)) errors.push(`${path}.statusCode 状态缺失`)
    if (isBlank(c.ownerId)) errors.push(`${path}.ownerId 负责人缺失`)
    if (!isFiniteNumber(c.amount) || Number(c.amount) < 0) errors.push(`${path}.amount 应为不小于 0 的数字`)
    if (!isFiniteNumber(c.receivedAmount) || Number(c.receivedAmount) < 0) {
      errors.push(`${path}.receivedAmount 应为不小于 0 的数字`)
    } else if (isFiniteNumber(c.amount) && Number(c.receivedAmount) > Number(c.amount) + 1e-9) {
      warnings.push(`${path}.receivedAmount 大于合同金额，请导入后核对`)
    }
    if (!isDateString(c.signDate)) errors.push(`${path}.signDate 应为 YYYY-MM-DD 日期`)
    if (!isDateString(c.dueDate)) errors.push(`${path}.dueDate 应为 YYYY-MM-DD 日期`)
    if (c.startDate && !isDateString(c.startDate)) errors.push(`${path}.startDate 应为 YYYY-MM-DD 日期`)
    if (c.statusChangedAt && !isTimestamp(c.statusChangedAt)) errors.push(`${path}.statusChangedAt 时间格式非法`)
    if (c.statusLogs !== undefined && !Array.isArray(c.statusLogs)) errors.push(`${path}.statusLogs 应为数组`)
    if (c.attachments !== undefined && !Array.isArray(c.attachments)) errors.push(`${path}.attachments 应为数组`)
    if (!isTimestamp(c.createdAt)) errors.push(`${path}.createdAt 缺失或格式非法`)
    if (!isTimestamp(c.updatedAt)) errors.push(`${path}.updatedAt 缺失或格式非法`)
  })

  // ---- 收款 ----
  const payments = requireArray('payments', '收款记录')
  const paymentIds = new Set()
  payments.forEach((p, i) => {
    const path = `payments[${i}]`
    if (!p || typeof p !== 'object') return errors.push(`${path} 不是合法对象`)
    if (isBlank(p.id)) errors.push(`${path}.id 缺失`)
    else if (paymentIds.has(p.id)) errors.push(`${path}.id 重复：${p.id}`)
    else paymentIds.add(p.id)
    if (isBlank(p.contractId)) errors.push(`${path}.contractId 缺失`)
    else if (!contractIds.has(p.contractId)) errors.push(`${path}.contractId 指向不存在的合同：${p.contractId}`)
    if (!isFiniteNumber(p.amount) || Number(p.amount) <= 0) errors.push(`${path}.amount 应为大于 0 的数字`)
    if (!isDateString(p.date)) errors.push(`${path}.date 应为 YYYY-MM-DD 日期`)
    if (!isTimestamp(p.createdAt)) errors.push(`${path}.createdAt 缺失或格式非法`)
    if (!isTimestamp(p.updatedAt)) errors.push(`${path}.updatedAt 缺失或格式非法`)
  })

  // ---- 人员 ----
  const personnel = requireArray('personnel', '人员')
  const personnelIds = new Set()
  personnel.forEach((p, i) => {
    const path = `personnel[${i}]`
    if (!p || typeof p !== 'object') return errors.push(`${path} 不是合法对象`)
    if (isBlank(p.id)) errors.push(`${path}.id 缺失`)
    else if (personnelIds.has(p.id)) errors.push(`${path}.id 重复：${p.id}`)
    else personnelIds.add(p.id)
    if (isBlank(p.code)) errors.push(`${path}.code 人员编号缺失`)
    if (isBlank(p.name)) errors.push(`${path}.name 姓名缺失`)
    if (p.active !== undefined && typeof p.active !== 'boolean') errors.push(`${path}.active 应为布尔值`)
    if (p.hireDate && !isDateString(p.hireDate)) errors.push(`${path}.hireDate 应为 YYYY-MM-DD 日期`)
    if (!isTimestamp(p.createdAt)) errors.push(`${path}.createdAt 缺失或格式非法`)
    if (!isTimestamp(p.updatedAt)) errors.push(`${path}.updatedAt 缺失或格式非法`)
  })
  contracts.forEach((c, i) => {
    if (c && c.ownerId && personnelIds.size && !personnelIds.has(c.ownerId)) {
      warnings.push(`contracts[${i}].ownerId 未匹配到人员档案，将保留负责人姓名快照`)
    }
  })

  // ---- 字典 ----
  const dicts = requireArray('dicts', '字典')
  const dictIds = new Set()
  const dictKeys = new Set()
  dicts.forEach((d, i) => {
    const path = `dicts[${i}]`
    if (!d || typeof d !== 'object') return errors.push(`${path} 不是合法对象`)
    if (isBlank(d.id)) errors.push(`${path}.id 缺失`)
    else if (dictIds.has(d.id)) errors.push(`${path}.id 重复：${d.id}`)
    else dictIds.add(d.id)
    if (isBlank(d.category)) errors.push(`${path}.category 字典分类缺失`)
    if (isBlank(d.code)) errors.push(`${path}.code 编码缺失`)
    if (isBlank(d.name)) errors.push(`${path}.name 名称缺失`)
    if (d.enabled !== undefined && typeof d.enabled !== 'boolean') errors.push(`${path}.enabled 应为布尔值`)
    if (d.sort !== undefined && !isFiniteNumber(d.sort)) errors.push(`${path}.sort 应为数字`)
    if (!isTimestamp(d.createdAt)) errors.push(`${path}.createdAt 缺失或格式非法`)
    if (!isTimestamp(d.updatedAt)) errors.push(`${path}.updatedAt 缺失或格式非法`)
    const key = `${d.category}::${String(d.code).toLowerCase()}`
    if (dictKeys.has(key)) warnings.push(`${path} 字典编码重复：${d.category}/${d.code}`)
    dictKeys.add(key)
  })

  // ---- 设置 ----
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    errors.push('data.settings 缺失或不是对象')
  } else {
    for (const [field, label] of [
      ['reminderDays', '到期提醒提前天数'],
      ['overdueDays', '逾期未收判定天数'],
      ['staleDays', '状态长期未变更天数'],
      ['pageSize', '每页条数'],
    ]) {
      if (data.settings[field] !== undefined && !isFiniteNumber(data.settings[field])) {
        errors.push(`settings.${field}（${label}）应为数字`)
      }
    }
    if (data.settings.dictCategories !== undefined && !Array.isArray(data.settings.dictCategories)) {
      warnings.push('settings.dictCategories 不是数组，将使用默认分类')
    }
  }

  return { ok: errors.length === 0, errors, warnings, counts }
}
