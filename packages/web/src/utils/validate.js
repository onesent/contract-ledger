import dayjs from 'dayjs'
import { formatMoney, isFiniteNumber, roundMoney } from './format'

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
          // 合同金额不得低于已收/已付或已交付金额（与领域层校验同口径，提前给出可读提示）
          const values = getValues() || {}
          if (isFiniteNumber(values.receivedAmount) && Number(value) < Number(values.receivedAmount)) {
            return callback(
              new Error(`合同金额不能低于已收/已付金额 ${formatMoney(values.receivedAmount, precision)}`),
            )
          }
          if (isFiniteNumber(values.deliveredAmount) && Number(value) < Number(values.deliveredAmount)) {
            return callback(
              new Error(`合同金额不能低于已交付金额 ${formatMoney(values.deliveredAmount, precision)}`),
            )
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
 * 交付登记校验规则（与 paymentRules 同构：金额、日期、验收状态必填，备注限长）。
 * 数量与单位仅作描述，不参与任何计算与校验。
 * @param {Object} ctx
 * @param {() => number} ctx.getMax 可交付上限（合同金额 − 已交付金额）
 * @param {number} [ctx.precision]
 * @returns {Object}
 */
export function deliveryRules({ getMax = () => Number.POSITIVE_INFINITY, precision = 2 }) {
  return {
    amount: [
      {
        validator: (_rule, value, callback) => {
          if (isBlank(value)) return callback(new Error('交付金额不能为空'))
          if (!isFiniteNumber(value)) return callback(new Error('交付金额必须是数字'))
          if (Number(value) <= 0) return callback(new Error('交付金额必须大于 0'))
          if (!hasValidPrecision(value, precision)) {
            return callback(new Error(`交付金额最多支持 ${precision} 位小数`))
          }
          const max = Number(getMax())
          if (Number.isFinite(max) && Number(value) > roundMoney(max, precision) + 1e-9) {
            return callback(new Error(`本次交付不能超过剩余可交付金额 ${roundMoney(max, precision)} 元`))
          }
          callback()
        },
        trigger: 'change',
      },
    ],
    date: [{ required: true, message: '请选择交付日期', trigger: 'change' }],
    status: [{ required: true, message: '请选择验收状态', trigger: 'change' }],
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
