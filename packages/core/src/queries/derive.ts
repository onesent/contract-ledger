/**
 * 纯派生查询：进度、错位、逾期/临期/长期未变更、合同视图、方向统计与提醒。
 * 全部实时计算、不落库；日期运算基于 YYYY-MM-DD 的 UTC 日历日，避免时区漂移。
 * 行为以旧版 src/utils/derive.js 为基准（金额改为整数分）。
 */
import type {
  ContractDirection,
  ContractView,
  GapState,
  IsoDate,
  Reminder,
  StatsSummary,
} from '../contracts/api-shapes.js'

/** 已完结 / 已终止状态：不再参与逾期类判定。 */
const CLOSED_STATUS_CODES: ReadonlySet<string> = new Set(['finished', 'terminated'])

/** 合同状态编码常量（与旧版 STATUS_CODES 一致）。 */
const EXECUTING_STATUS = 'executing'

/** 派生函数可接受的合同结构（兼容视图行与旧字段）。 */
export interface DeriveContract {
  readonly id: string
  readonly no?: string
  readonly counterparty?: string
  readonly ownerName?: string
  readonly direction: ContractDirection
  readonly amountCents: number
  readonly paidCents?: number
  readonly deliveredCents?: number
  /** paidCents 的旧前端兼容别名。 */
  readonly receivedAmountCents?: number
  readonly statusCode: string
  readonly signDate: IsoDate
  readonly dueDate: IsoDate
  readonly startDate?: IsoDate
  readonly paymentDate?: IsoDate
  readonly lastPaymentDate?: IsoDate | null
  readonly lastDeliveryDate?: IsoDate | null
  readonly statusChangedAt?: string | null
  readonly updatedAt?: string
  readonly createdAt?: string
}

/** 资金流水聚合（派生统计与提醒用）。 */
export interface DerivePayment {
  readonly contractId: string
  readonly date: IsoDate
  readonly amountCents: number
}

/** 派生统计可选项：提醒天数与流水（用于 paymentCount）。 */
export interface DeriveStatsOptions {
  readonly reminderDays?: number
  readonly overdueDays?: number
  readonly payments?: readonly DerivePayment[]
}

/** 单方向统计摘要：在冻结字段之外补充按状态计数的映射。 */
export interface DirectionStatsSummary extends StatsSummary {
  readonly statusCounts: Readonly<Record<string, number>>
}

/** 按方向拆分的统计结果；销售与采购永不相加。 */
export interface DirectionStats {
  readonly sale: DirectionStatsSummary
  readonly purchase: DirectionStatsSummary
}

/** 提醒设置。 */
export interface ReminderSettings {
  readonly reminderDays?: number
  readonly overdueDays?: number
  readonly staleDays?: number
  readonly ignoredReminders?: readonly string[]
}

/** 合同视图构造入参。 */
export interface BuildContractViewInput {
  readonly contract: DeriveContract & {
    readonly projectName?: string
    readonly typeCode?: string
    readonly typeName?: string
    readonly typeItemId?: string
    readonly statusName?: string
    readonly statusItemId?: string
    readonly ownerId?: string | null
    readonly note?: string
    readonly openingPaidCents?: number
    readonly openingDeliveredCents?: number
  }
  /** 资金流水合计（分，不含开账余额）。 */
  readonly paidCents: number
  /** 交付明细合计（分，不含开账余额）。 */
  readonly deliveredCents: number
  readonly lastDeliveryDate?: IsoDate | null
}

/** 提醒分组定义（顺序即展示顺序，与旧版一致）。 */
export const REMINDER_GROUPS = [
  {
    key: 'dueSoon',
    title: '即将到期',
    type: 'warning',
    quick: 'dueSoon',
    description: '到期日在提醒天数内且尚未完结',
  },
  {
    key: 'overdue',
    title: '已逾期合同',
    type: 'error',
    quick: 'overdue',
    description: '已过到期日且状态非已完结/已终止',
  },
  {
    key: 'overdueUnpaid',
    title: '逾期未收款',
    type: 'error',
    quick: 'overdueUnpaid',
    description: '有未收金额且超过逾期判定天数',
  },
  {
    key: 'zeroReceived',
    title: '执行中未收款',
    type: 'warning',
    quick: 'zeroReceived',
    description: '已开始执行但已收金额为 0',
  },
  {
    key: 'stale',
    title: '长期未变更状态',
    type: 'info',
    quick: 'stale',
    description: '执行中且状态超过设定天数未变化',
  },
  {
    key: 'dataQuality',
    title: '数据质量异常',
    type: 'info',
    quick: 'invalid',
    description: '到期日缺失或日期/金额逻辑异常',
  },
  {
    key: 'overdueDelivery',
    title: '超期未交付',
    type: 'error',
    quick: 'overdueDelivery',
    description: '已过到期日且交付进度未达 100%',
  },
  {
    key: 'deliveredUnpaid',
    title: '已交付未收/付款',
    type: 'warning',
    quick: 'deliveredUnfunded',
    description: '存在未收/未付金额且已交付金额大于 0，超过逾期判定天数未收到资金',
  },
  {
    key: 'prepaidUndelivered',
    title: '预收款/预付款未交付',
    type: 'info',
    quick: 'fundedUndelivered',
    description: '已收/已付金额大于已交付金额且合同未完结',
  },
] as const

/** 提醒快捷筛选键。 */
type QuickKey = (typeof REMINDER_GROUPS)[number]['quick']

/**
 * 解析 YYYY-MM-DD 为 UTC 日历日序号（1970-01-01 起的天数）。
 * @param date 业务日期
 * @returns 天数序号；非法日期返回 null
 */
export function parseIsoDateToUtcDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const [, yearText = '', monthText = '', dayText = ''] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }
  return timestamp / 86_400_000
}

/**
 * 相对今天的天数差（正数=未来，0=今天）。
 * @param date 业务日期
 * @param today 今天（YYYY-MM-DD）
 * @returns 天数差；任一侧非法返回 null
 */
export function daysFromToday(date: string, today: string): number | null {
  const target = parseIsoDateToUtcDay(date)
  const base = parseIsoDateToUtcDay(today)
  if (target === null || base === null) return null
  return target - base
}

/**
 * 从 ISO 时间戳提取业务日期（取前 10 位；无时区信息时按 UTC 日期）。
 * @param value ISO 时间戳
 * @returns YYYY-MM-DD；非法返回 null
 */
export function toIsoDate(value: string): IsoDate | null {
  const candidate = value.slice(0, 10)
  return parseIsoDateToUtcDay(candidate) === null ? null : candidate
}

/**
 * 四舍五入到 2 位小数（与旧版 roundMoney 同口径）。
 * @param value 数值
 * @returns 舍入结果
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * 计算百分比并夹在 0..100；总额 ≤ 0 或非法返回 null。
 * 旧版对超 100 的数据同样夹紧到 100。
 * @param value 分子
 * @param total 分母
 * @returns 0..100 的两位小数或 null
 */
function percentOf(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null
  const percent = (value / total) * 100
  if (!Number.isFinite(percent)) return null
  return Math.min(100, Math.max(0, round2(percent)))
}

/**
 * 判断状态是否属于流程已结束。
 * @param statusCode 合同状态编码
 * @returns 已完结或已终止返回 true
 */
function isClosedStatus(statusCode: string): boolean {
  return CLOSED_STATUS_CODES.has(statusCode)
}

/**
 * 资金进度（0..100）：已付/已收占合同金额比例；合同金额为 0 返回 null。
 * @param input 合同金额与已付金额（分）
 * @returns 进度或 null
 */
export function fundingPercent(input: { amountCents: number; paidCents: number }): number | null {
  return percentOf(input.paidCents, input.amountCents)
}

/**
 * 交付进度（0..100）：已交付占合同金额比例；合同金额为 0 返回 null。
 * @param input 合同金额与已交付金额（分）
 * @returns 进度或 null
 */
export function deliveryPercent(input: { amountCents: number; deliveredCents: number }): number | null {
  return percentOf(input.deliveredCents, input.amountCents)
}

/**
 * 错位差额 = 已付 − 已交付（正数资金先行，负数交付先行）。
 * @param input 已付与已交付金额（分）
 * @returns 差额（分）
 */
export function executionGap(input: { paidCents: number; deliveredCents: number }): number {
  return round2(input.paidCents - input.deliveredCents)
}

/**
 * 错位状态：none / balanced / prepaid / receivable。
 * @param input 合同金额与已付/已交付金额（分）
 * @returns 错位状态
 */
export function gapState(input: {
  amountCents: number
  paidCents: number
  deliveredCents: number
}): GapState {
  const { amountCents, paidCents, deliveredCents } = input
  if (amountCents <= 0 || (paidCents === 0 && deliveredCents === 0)) return 'none'
  const gap = round2(paidCents - deliveredCents)
  if (gap === 0) return 'balanced'
  return gap > 0 ? 'prepaid' : 'receivable'
}

/**
 * 是否已逾期：到期日已过且状态非已完结/已终止。
 * @param input 到期日、状态与今天
 * @returns 是否逾期
 */
export function isOverdue(input: { dueDate: IsoDate; statusCode: string; today: IsoDate }): boolean {
  const diff = daysFromToday(input.dueDate, input.today)
  if (diff === null) return false
  if (isClosedStatus(input.statusCode)) return false
  return diff < 0
}

/**
 * 是否临期：到期日在 [今天, 今天 + reminderDays] 内；提供状态时排除已结束合同。
 * @param input 到期日、今天、提醒天数与可选状态
 * @returns 是否临期
 */
export function isDueSoon(input: {
  dueDate: IsoDate
  today: IsoDate
  reminderDays: number
  statusCode?: string
}): boolean {
  const diff = daysFromToday(input.dueDate, input.today)
  if (diff === null) return false
  if (input.statusCode !== undefined && isClosedStatus(input.statusCode)) return false
  const reminderDays = Number.isFinite(input.reminderDays) ? input.reminderDays : 30
  return diff >= 0 && diff <= reminderDays
}

/**
 * 是否长期未变更：执行中且最后一次状态变更超过 staleDays 天（严格大于）。
 * @param input 状态变更时间、今天、阈值与可选状态/更新时间
 * @returns 是否长期未变更
 */
export function isStale(input: {
  statusChangedAt?: string | null
  today: IsoDate
  staleDays: number
  statusCode?: string
  updatedAt?: string | null
  createdAt?: string | null
}): boolean {
  if (input.statusCode !== undefined && input.statusCode !== EXECUTING_STATUS) return false
  const last = input.statusChangedAt || input.updatedAt || input.createdAt
  if (!last) return false
  const lastDate = toIsoDate(last)
  if (lastDate === null) return false
  const diff = daysFromToday(lastDate, input.today)
  if (diff === null) return false
  const staleDays = Number.isFinite(input.staleDays) ? input.staleDays : 90
  return -diff > staleDays
}

/**
 * 数据质量异常列表（日期逻辑 / 金额字段）。
 * @param contract 合同
 * @param paidCents 已付金额；缺省取合同自身字段
 * @returns 异常原因列表
 */
export function dataQualityIssues(contract: DeriveContract, paidCents?: number): string[] {
  const issues: string[] = []
  const paid = paidCents ?? contract.paidCents ?? contract.receivedAmountCents ?? 0
  if (!contract.dueDate) issues.push('到期日缺失')
  if (!contract.signDate) issues.push('签订日期缺失')
  if (contract.signDate && contract.dueDate && contract.dueDate < contract.signDate) {
    issues.push('到期日早于签订日期')
  }
  const start = contract.startDate || contract.signDate
  if (start && contract.dueDate && contract.dueDate < start) issues.push('到期日早于开始日期')
  if (!Number.isFinite(contract.amountCents) || contract.amountCents < 0) issues.push('合同金额非法')
  if (!Number.isFinite(paid) || paid < 0) issues.push('已收金额非法')
  if (paid > contract.amountCents) issues.push('已收金额大于合同金额')
  if (contract.statusChangedAt && toIsoDate(contract.statusChangedAt) === null) {
    issues.push('状态变更时间非法')
  }
  return issues
}

/**
 * 构造合同视图：补齐未付、进度、错位与旧前端兼容别名。
 * 参照 SQL 视图口径：paidCents = 开账余额 + 流水合计，deliveredCents = 开账余额 + 明细合计。
 * @param input 合同、流水合计、明细合计与最后交付日
 * @returns 合同视图行
 */
export function buildContractView(input: BuildContractViewInput): ContractView {
  const { contract } = input
  const amount = contract.amountCents
  const openingPaid = contract.openingPaidCents ?? 0
  const openingDelivered = contract.openingDeliveredCents ?? 0
  const paid = openingPaid + input.paidCents
  const delivered = openingDelivered + input.deliveredCents
  const unpaid = Math.max(0, amount - paid)
  return {
    id: contract.id,
    no: contract.no ?? '',
    projectName: contract.projectName ?? '',
    direction: contract.direction,
    counterparty: contract.counterparty ?? '',
    typeItemId: contract.typeItemId ?? '',
    typeCode: contract.typeCode ?? '',
    typeName: contract.typeName ?? contract.typeCode ?? '',
    statusItemId: contract.statusItemId ?? '',
    statusCode: contract.statusCode,
    statusName: contract.statusName ?? contract.statusCode,
    amountCents: amount,
    openingPaidCents: openingPaid,
    paidCents: paid,
    unpaidCents: unpaid,
    receivedAmountCents: paid,
    openingDeliveredCents: openingDelivered,
    deliveredCents: delivered,
    lastDeliveryDate: input.lastDeliveryDate ?? contract.lastDeliveryDate ?? null,
    fundingPercent: fundingPercent({ amountCents: amount, paidCents: paid }),
    deliveryPercent: deliveryPercent({ amountCents: amount, deliveredCents: delivered }),
    executionGapCents: executionGap({ paidCents: paid, deliveredCents: delivered }),
    gapState: gapState({ amountCents: amount, paidCents: paid, deliveredCents: delivered }),
    ownerId: contract.ownerId ?? null,
    ownerName: contract.ownerName ?? '',
    note: contract.note ?? '',
    signDate: contract.signDate,
    startDate: contract.startDate ?? contract.signDate,
    dueDate: contract.dueDate,
    statusChangedAt: contract.statusChangedAt ?? null,
    createdAt: contract.createdAt ?? '1970-01-01T00:00:00.000Z',
    updatedAt: contract.updatedAt ?? '1970-01-01T00:00:00.000Z',
  }
}

/** 资金流水聚合结果。 */
interface PaymentAggregate {
  totalCents: number
  lastDate: IsoDate | null
}

/**
 * 按合同聚合流水金额与最后日期。
 * @param payments 流水列表
 * @returns contractId → 聚合
 */
function aggregatePayments(payments: readonly DerivePayment[]): Map<string, PaymentAggregate> {
  const result = new Map<string, PaymentAggregate>()
  for (const payment of payments) {
    const existing = result.get(payment.contractId)
    if (existing === undefined) {
      result.set(payment.contractId, { totalCents: payment.amountCents, lastDate: payment.date })
      continue
    }
    existing.totalCents += payment.amountCents
    if (existing.lastDate === null || payment.date > existing.lastDate) existing.lastDate = payment.date
  }
  return result
}

/**
 * 解析合同已付金额：优先使用视图字段，其次流水聚合。
 * @param contract 合同
 * @param payments 流水聚合
 * @returns 已付金额（分）
 */
function paidOf(contract: DeriveContract, payments: Map<string, PaymentAggregate>): number {
  if (typeof contract.paidCents === 'number') return contract.paidCents
  if (typeof contract.receivedAmountCents === 'number') return contract.receivedAmountCents
  return payments.get(contract.id)?.totalCents ?? 0
}

/**
 * 解析合同最后付款日期。
 * @param contract 合同
 * @param payments 流水聚合
 * @returns 最后付款日期或 null
 */
function lastPaymentOf(contract: DeriveContract, payments: Map<string, PaymentAggregate>): IsoDate | null {
  if (contract.lastPaymentDate) return contract.lastPaymentDate
  if (contract.paymentDate) return contract.paymentDate
  return payments.get(contract.id)?.lastDate ?? null
}

/**
 * 是否逾期未付：仍有未付金额、状态未结束，且最近付款日/到期日超过逾期判定天数。
 * @param contract 合同
 * @param paid 已付金额
 * @param lastPaymentDate 最后付款日期
 * @param overdueDays 逾期判定天数
 * @param today 今天
 * @returns 是否逾期未付
 */
function isOverdueUnpaid(
  contract: DeriveContract,
  paid: number,
  lastPaymentDate: IsoDate | null,
  overdueDays: number,
  today: IsoDate,
): boolean {
  const unpaid = Math.max(0, contract.amountCents - paid)
  if (unpaid <= 0) return false
  if (isClosedStatus(contract.statusCode)) return false
  const base = lastPaymentDate ?? contract.dueDate
  const diff = daysFromToday(base, today)
  if (diff === null) return false
  return diff < -overdueDays
}

/**
 * 是否超期未交付：金额大于 0、未结束、已过到期日且交付进度未达 100%。
 * @param contract 合同
 * @param delivered 已交付金额
 * @param today 今天
 * @returns 是否超期未交付
 */
function isOverdueDelivery(contract: DeriveContract, delivered: number, today: IsoDate): boolean {
  if (contract.amountCents <= 0) return false
  if (isClosedStatus(contract.statusCode)) return false
  const percent = deliveryPercent({ amountCents: contract.amountCents, deliveredCents: delivered })
  if (percent === null || percent >= 100) return false
  const diff = daysFromToday(contract.dueDate, today)
  return diff !== null && diff < 0
}

/**
 * 归一化方向：非采购一律视为销售（与旧版 normalizeDirection 一致）。
 * @param direction 方向值
 * @returns sale 或 purchase
 */
function normalizeDirection(direction: ContractDirection): ContractDirection {
  return direction === 'purchase' ? 'purchase' : 'sale'
}

/**
 * 构造单个方向的统计摘要。
 * @param direction 方向
 * @param contracts 合同列表
 * @param payments 流水聚合
 * @param scopedPayments 流水列表
 * @param today 今天
 * @param options 选项
 * @returns 统计摘要
 */
function buildStats(
  direction: ContractDirection,
  contracts: readonly DeriveContract[],
  payments: Map<string, PaymentAggregate>,
  scopedPayments: readonly DerivePayment[],
  today: IsoDate,
  options: DeriveStatsOptions,
): DirectionStatsSummary {
  const list = contracts.filter((contract) => normalizeDirection(contract.direction) === direction)
  const reminderDays = options.reminderDays ?? 30
  const overdueDays = options.overdueDays ?? 0
  const monthKey = today.slice(0, 7)
  const ids = new Set(list.map((contract) => contract.id))
  const statusCounts: Record<string, number> = {}

  let totalAmountCents = 0
  let receivedAmountCents = 0
  let deliveredAmountCents = 0
  let unpaidAmountCents = 0
  let executingCount = 0
  let monthSignedCount = 0
  let monthSignedAmountCents = 0
  let dueSoonCount = 0
  let overdueCount = 0
  let overdueUnpaidAmountCents = 0

  for (const contract of list) {
    const paid = paidOf(contract, payments)
    const delivered = contract.deliveredCents ?? 0
    const unpaid = Math.max(0, contract.amountCents - paid)
    totalAmountCents += contract.amountCents
    receivedAmountCents += paid
    deliveredAmountCents += delivered
    unpaidAmountCents += unpaid
    statusCounts[contract.statusCode] = (statusCounts[contract.statusCode] ?? 0) + 1
    if (contract.statusCode === EXECUTING_STATUS) executingCount += 1
    if (contract.signDate && contract.signDate.slice(0, 7) === monthKey) {
      monthSignedCount += 1
      monthSignedAmountCents += contract.amountCents
    }
    if (
      isDueSoon({
        dueDate: contract.dueDate,
        today,
        reminderDays,
        statusCode: contract.statusCode,
      })
    ) {
      dueSoonCount += 1
    }
    if (isOverdue({ dueDate: contract.dueDate, statusCode: contract.statusCode, today })) {
      overdueCount += 1
    }
    if (
      isOverdueUnpaid(contract, paid, lastPaymentOf(contract, payments), overdueDays, today)
    ) {
      overdueUnpaidAmountCents += unpaid
    }
  }

  const paymentCount = scopedPayments.filter((payment) => ids.has(payment.contractId)).length

  return {
    direction,
    contractCount: list.length,
    totalAmountCents,
    receivedAmountCents,
    deliveredAmountCents,
    unpaidAmountCents,
    fundingPercent: percentOf(receivedAmountCents, totalAmountCents),
    deliveryPercent: percentOf(deliveredAmountCents, totalAmountCents),
    executingCount,
    monthSignedCount,
    monthSignedAmountCents,
    dueSoonCount,
    overdueCount,
    overdueUnpaidAmountCents,
    paymentCount,
    statusCounts,
  }
}

/**
 * 按方向统计（销售/采购分别计算，永不相加）。
 * @param contracts 合同列表
 * @param today 今天（YYYY-MM-DD）
 * @param options 提醒天数与流水
 * @returns 销售与采购各自的统计摘要
 */
export function deriveStats(
  contracts: readonly DeriveContract[],
  today: IsoDate,
  options: DeriveStatsOptions = {},
): DirectionStats {
  const paymentsList = options.payments ?? []
  const payments = aggregatePayments(paymentsList)
  return {
    sale: buildStats('sale', contracts, payments, paymentsList, today, options),
    purchase: buildStats('purchase', contracts, payments, paymentsList, today, options),
  }
}

/**
 * 判断合同是否命中某个提醒快捷筛选（与旧版 matchesQuick 的分组分支一致）。
 * @param contract 合同
 * @param quick 快捷筛选键
 * @param context 计算上下文
 * @returns 是否命中
 */
type ReminderMatcher = (contract: DeriveContract, context: ReminderContext) => boolean

/** 提醒计算上下文。 */
interface ReminderContext {
  today: IsoDate
  reminderDays: number
  overdueDays: number
  staleDays: number
  payments: Map<string, PaymentAggregate>
}

const REMINDER_MATCHERS: Record<QuickKey, ReminderMatcher> = {
  dueSoon: (contract, context) =>
    isDueSoon({
      dueDate: contract.dueDate,
      today: context.today,
      reminderDays: context.reminderDays,
      statusCode: contract.statusCode,
    }),
  overdue: (contract, context) =>
    isOverdue({ dueDate: contract.dueDate, statusCode: contract.statusCode, today: context.today }),
  overdueUnpaid: (contract, context) =>
    isOverdueUnpaid(
      contract,
      paidOf(contract, context.payments),
      lastPaymentOf(contract, context.payments),
      context.overdueDays,
      context.today,
    ),
  zeroReceived: (contract, context) =>
    contract.statusCode === EXECUTING_STATUS &&
    paidOf(contract, context.payments) === 0 &&
    contract.amountCents > 0,
  stale: (contract, context) =>
    isStale({
      statusChangedAt: contract.statusChangedAt,
      updatedAt: contract.updatedAt,
      createdAt: contract.createdAt,
      today: context.today,
      staleDays: context.staleDays,
      statusCode: contract.statusCode,
    }),
  invalid: (contract, context) =>
    dataQualityIssues(contract, paidOf(contract, context.payments)).length > 0,
  overdueDelivery: (contract, context) =>
    isOverdueDelivery(contract, contract.deliveredCents ?? 0, context.today),
  deliveredUnfunded: (contract, context) => {
    const paid = paidOf(contract, context.payments)
    const delivered = contract.deliveredCents ?? 0
    const unpaid = Math.max(0, contract.amountCents - paid)
    return delivered > 0 && unpaid > 0
  },
  fundedUndelivered: (contract, context) => {
    const paid = paidOf(contract, context.payments)
    const delivered = contract.deliveredCents ?? 0
    return paid > 0 && paid > delivered
  },
}

/**
 * 计算提醒清单（纯函数，与旧版 computeReminders 的顺序/分类一致）。
 * @param contracts 合同列表
 * @param payments 流水列表
 * @param today 今天（YYYY-MM-DD）
 * @param settings 提醒设置（天数与忽略键）
 * @returns 提醒分组数组
 */
export function deriveReminders(
  contracts: readonly DeriveContract[],
  payments: readonly DerivePayment[],
  today: IsoDate,
  settings: ReminderSettings = {},
): Reminder[] {
  const paymentMap = aggregatePayments(payments)
  const context: ReminderContext = {
    today,
    reminderDays: settings.reminderDays ?? 30,
    overdueDays: settings.overdueDays ?? 0,
    staleDays: settings.staleDays ?? 90,
    payments: paymentMap,
  }
  const ignored = new Set(settings.ignoredReminders ?? [])

  return REMINDER_GROUPS.map((group) => {
    const matcher = REMINDER_MATCHERS[group.quick]
    const matched = contracts.filter((contract) => matcher(contract, context))
    const visible = matched.filter((contract) => !ignored.has(`${group.key}:${contract.id}`))
    const items = visible.slice(0, 8).map((contract) => {
      const paid = paidOf(contract, paymentMap)
      return {
        id: contract.id,
        no: contract.no ?? '',
        counterparty: contract.counterparty ?? '',
        dueDate: contract.dueDate,
        ownerName: contract.ownerName ?? '',
        unpaidCents: Math.max(0, contract.amountCents - paid),
        issues: group.key === 'dataQuality' ? dataQualityIssues(contract, paid) : [],
        ignoreKey: `${group.key}:${contract.id}`,
      }
    })
    return {
      key: group.key,
      title: group.title,
      type: group.type,
      quick: group.quick,
      description: group.description,
      count: visible.length,
      totalCount: matched.length,
      ignoredCount: matched.length - visible.length,
      items,
    }
  })
}
