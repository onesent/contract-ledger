<template>
  <el-drawer
    v-model="visible"
    :size="drawerSize"
    :title="contract ? `合同详情 · ${contract.no}` : '合同详情'"
    append-to-body
    destroy-on-close
  >
    <template v-if="contract">
      <div class="toolbar" style="margin-bottom: 14px">
        <el-tag effect="plain" :style="tagStyle(contract.statusColor)">{{ contract.statusName }}</el-tag>
        <el-tag effect="plain" :style="tagStyle(contract.typeColor)">{{ contract.typeName }}</el-tag>
        <el-tag effect="plain">{{ ledger.directionLabel(direction) }}</el-tag>
        <el-tag v-if="contract.overdue" type="danger" effect="plain">已逾期 {{ contract.overdueDays }} 天</el-tag>
        <el-tag v-else-if="contract.dueSoon" type="warning" effect="plain">即将到期</el-tag>
        <el-tag v-if="contract.issues.length" type="warning" effect="plain">
          数据质量异常 {{ contract.issues.length }} 项
        </el-tag>
        <div class="toolbar-spacer" />
        <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
          <span>
            <el-button type="primary" size="small" :disabled="!writable" @click="emit('edit', contract)">编辑</el-button>
          </span>
        </el-tooltip>
        <el-tooltip
          :content="
            !writable
              ? '仅可浏览与导出（当前为只读模式）'
              : contract.unpaid > 0
                ? `登记一笔${funding.verb}`
                : `该合同没有${funding.unpaid}`
          "
          placement="top"
        >
          <span>
            <el-button size="small" :disabled="!writable || contract.unpaid <= 0" @click="emit('payment', contract)">
              登记{{ funding.verb }}
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip
          :content="
            !writable
              ? '仅可浏览与导出（当前为只读模式）'
              : deliveryDone
                ? '交付金额已达到合同金额，无需继续登记'
                : '登记一笔交付执行明细'
          "
          placement="top"
        >
          <span>
            <el-button size="small" :disabled="!writable || deliveryDone" @click="emit('delivery', contract)">
              登记交付
            </el-button>
          </span>
        </el-tooltip>
      </div>

      <el-descriptions :column="descColumns" border size="small" class="detail-section">
        <el-descriptions-item label="合同编号">{{ contract.no }}</el-descriptions-item>
        <el-descriptions-item :label="`${party}名称`">{{ contract.customer }}</el-descriptions-item>
        <el-descriptions-item label="合同类型">{{ contract.typeName }}</el-descriptions-item>
        <el-descriptions-item label="合同金额">
          <span class="money-cell">{{ formatMoney(contract.amount, precision) }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="funding.received">
          <span class="money-cell">{{ formatMoney(contract.receivedAmount, precision) }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="funding.unpaid">
          <span class="money-cell" :class="{ 'is-unpaid': contract.unpaid > 0 }">
            {{ formatMoney(contract.unpaid, precision) }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="已交付金额">
          <span class="money-cell">{{ formatMoney(contract.deliveredAmount, precision) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="最后交付日期">
          <span :class="{ muted: !contract.lastDeliveryDate }">
            {{ contract.lastDeliveryDate ? formatDate(contract.lastDeliveryDate) : '—' }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item :label="funding.progress">
          <div class="progress-preview">
            <el-progress
              v-if="contract.fundingPercent !== null"
              :percentage="contract.fundingPercent"
              :stroke-width="10"
              :show-text="false"
            />
            <span class="small" :class="{ muted: contract.fundingPercent === null }">
              {{ contract.fundingPercent === null ? '—（合同金额为 0）' : formatPercent(contract.fundingPercent, 1) }}
            </span>
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="交付进度">
          <div class="progress-preview">
            <el-progress
              v-if="contract.deliveryPercent !== null"
              :percentage="contract.deliveryPercent"
              :stroke-width="10"
              :show-text="false"
            />
            <span class="small" :class="{ muted: contract.deliveryPercent === null }">
              {{ contract.deliveryPercent === null ? '—（合同金额为 0）' : formatPercent(contract.deliveryPercent, 1) }}
            </span>
          </div>
        </el-descriptions-item>
        <el-descriptions-item :label="funding.date">{{ formatDate(contract.paymentDate) }}</el-descriptions-item>
        <el-descriptions-item label="签订日期">{{ formatDate(contract.signDate) }}</el-descriptions-item>
        <el-descriptions-item label="开始日期">
          {{ formatDate(contract.startDate || contract.signDate) }}
        </el-descriptions-item>
        <el-descriptions-item label="到期日">
          <span :class="{ 'text-danger': contract.overdue, 'text-warning': !contract.overdue && contract.dueSoon }">
            {{ formatDate(contract.dueDate) }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="状态">{{ contract.statusName }}</el-descriptions-item>
        <el-descriptions-item label="负责人">
          {{ contract.ownerName }}
          <el-tooltip
            v-if="contract.ownerActive === false"
            content="负责人已离职，合同保留保存时的姓名快照"
            placement="top"
          >
            <el-tag type="warning" effect="plain" size="small" style="margin-left: 6px">已离职</el-tag>
          </el-tooltip>
        </el-descriptions-item>
        <el-descriptions-item label="状态变更时间">
          {{ formatDateTime(contract.statusChangedAt) }}
        </el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDateTime(contract.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ formatDateTime(contract.updatedAt) }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="descColumns">
          <span v-if="contract.note">{{ contract.note }}</span>
          <span v-else class="muted">—</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="gapInfo"
        :type="gapInfo.type"
        show-icon
        :closable="false"
        :title="gapInfo.title"
        style="margin-bottom: 16px"
      >
        {{ gapInfo.text }}
      </el-alert>

      <el-alert
        v-if="canFinish"
        type="success"
        show-icon
        :closable="false"
        title="资金与交付均已完成，可标记为「已完结」"
        style="margin-bottom: 16px"
      >
        收款与交付进度都已达到 100%。状态不会自动变更，请在编辑中手动改为「已完结」。
      </el-alert>

      <el-alert
        v-if="contract.issues.length"
        type="warning"
        show-icon
        :closable="false"
        title="数据质量提醒"
        style="margin-bottom: 16px"
      >
        {{ contract.issues.join('；') }}
      </el-alert>

      <div class="detail-section">
        <div class="toolbar">
          <h4 style="margin: 0">AI 辅助（预留）</h4>
          <div class="toolbar-spacer" />
          <el-tooltip :disabled="aiReady" content="请在设置中配置 AI 后使用" placement="top">
            <span>
              <el-button size="small" :disabled="!aiReady" :loading="aiLoading === 'summary'" @click="runSummary">
                AI 摘要 / 风险点
              </el-button>
            </span>
          </el-tooltip>
          <el-tooltip :disabled="aiReady" content="请在设置中配置 AI 后使用" placement="top">
            <span>
              <el-button
                size="small"
                :disabled="!aiReady"
                :loading="aiLoading === 'reminder'"
                @click="runReminder"
              >
                生成催收文案
              </el-button>
            </span>
          </el-tooltip>
        </div>
        <p class="ai-hint">
          未配置时按钮禁用；配置后仍使用 src/ai/provider.js 中的占位实现，不会自动发起网络请求。
        </p>
      </div>

      <div class="detail-section">
        <h4>附件元信息（{{ contract.attachments.length }}）</h4>
        <el-table v-if="contract.attachments.length" :data="contract.attachments" size="small" border>
          <el-table-column prop="name" label="文件名" min-width="180" show-overflow-tooltip />
          <el-table-column label="大小" width="100">
            <template #default="{ row }">{{ formatFileSize(row.size) }}</template>
          </el-table-column>
          <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
          <el-table-column label="添加时间" width="160">
            <template #default="{ row }">
              <span class="muted small">{{ formatDateTime(row.addedAt) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无附件元信息（仅记录元信息，不上传文件）" :image-size="60" />
      </div>

      <div class="detail-section">
        <h4>{{ funding.verb }}流水（{{ payments.length }} 条，合计 {{ formatMoney(paymentsTotal, precision) }}）</h4>
        <el-timeline v-if="payments.length" class="timeline-card">
          <el-timeline-item
            v-for="payment in payments"
            :key="payment.id"
            :timestamp="`${formatDate(payment.date)} · ${formatDateTime(payment.createdAt)}`"
            type="success"
            placement="top"
          >
            <div class="timeline-item-head">
              <span class="timeline-amount">{{ formatMoney(payment.amount, precision) }}</span>
              <el-tag v-if="payment.methodName" size="small" effect="plain">{{ payment.methodName }}</el-tag>
              <span v-if="payment.note" class="muted">{{ payment.note }}</span>
              <div class="toolbar-spacer" />
              <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
                <span>
                  <el-button link type="danger" size="small" :disabled="!writable" @click="removePayment(payment)">删除</el-button>
                </span>
              </el-tooltip>
            </div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else :description="`暂无${funding.verb}记录`" :image-size="60" />
      </div>

      <div class="detail-section">
        <h4>交付执行明细（{{ deliveries.length }} 条，计入合计 {{ formatMoney(deliveriesTotal, precision) }}）</h4>
        <el-timeline v-if="deliveries.length" class="timeline-card">
          <el-timeline-item
            v-for="delivery in deliveries"
            :key="delivery.id"
            :timestamp="`${formatDate(delivery.date)} · ${formatDateTime(delivery.createdAt)}`"
            :type="deliveryTagType(delivery.status)"
            placement="top"
          >
            <div class="timeline-item-head">
              <span class="timeline-amount">{{ formatMoney(delivery.amount, precision) }}</span>
              <el-tag size="small" effect="plain" :type="deliveryTagType(delivery.status)">
                {{ deliveryStatusName(delivery.status) }}
              </el-tag>
              <span v-if="delivery.quantity" class="muted small">
                数量 {{ formatNumber(delivery.quantity) }}{{ delivery.unit || '' }}
              </span>
              <span v-if="delivery.note" class="muted">{{ delivery.note }}</span>
              <div class="toolbar-spacer" />
              <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
                <span>
                  <el-button
                    link
                    type="danger"
                    size="small"
                    :disabled="!writable"
                    @click="emit('delete-delivery', delivery)"
                  >
                    删除
                  </el-button>
                </span>
              </el-tooltip>
            </div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无交付记录" :image-size="60" />
      </div>

      <div class="detail-section">
        <h4>状态变更日志（{{ statusLogs.length }} 条）</h4>
        <el-timeline v-if="statusLogs.length" class="timeline-card">
          <el-timeline-item
            v-for="log in statusLogs"
            :key="log.id || `${log.at}-${log.to}`"
            :timestamp="formatDateTime(log.at)"
            :type="logType(log.to)"
            placement="top"
          >
            <div class="timeline-item-head">
              <span>{{ fromName(log.from) }}</span>
              <el-icon><Right /></el-icon>
              <el-tag size="small" effect="plain" :style="tagStyle(statusColor(log.to))">
                {{ toName(log.to) }}
              </el-tag>
              <span class="muted small">操作人：{{ log.by || '—' }}</span>
            </div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无状态变更日志" :image-size="60" />
      </div>
    </template>
    <el-empty v-else description="请选择合同" />
  </el-drawer>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Right } from '@element-plus/icons-vue'
import { useLedger } from '../composables/useLedger'
import { useMediaQuery } from '../composables/useMediaQuery'
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatMoney,
  formatNumber,
  formatPercent,
  toNumber,
} from '../utils/format'
import { draftReminder, summarize } from '../ai/provider'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  contract: { type: Object, default: null },
  direction: { type: String, default: 'sale' },
})

const emit = defineEmits(['update:modelValue', 'edit', 'payment', 'delivery', 'delete-delivery'])

const ledger = useLedger()
const isNarrow = useMediaQuery('(max-width: 1023px)')
const precision = ledger.precision
const aiLoading = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const drawerSize = computed(() => (isNarrow.value ? '100%' : '680px'))
const descColumns = computed(() => (isNarrow.value ? 1 : 2))
const aiReady = computed(() => ledger.aiReady.value)
const writable = computed(() => ledger.storageInfo.value.writable)

/** 当前方向（缺失 / 非法一律按销售处理，与存储层口径一致）。 */
const direction = computed(() => (props.direction === 'purchase' ? 'purchase' : 'sale'))
const party = computed(() => ledger.partyLabel(direction.value))
const funding = computed(() => ledger.fundingLabels(direction.value))

const payments = computed(() => {
  if (!props.contract) return []
  return ledger.data.payments
    .filter((payment) => payment.contractId === props.contract.id)
    .map((payment) => ({
      ...payment,
      methodName: ledger.dictLookup.value.get(`payMethod:${payment.methodCode}`)?.name || '',
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
})

const paymentsTotal = computed(() =>
  payments.value.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
)

const deliveries = computed(() => {
  if (!props.contract) return []
  return ledger.deliveriesFor(props.contract.id)
})

/** 计入合计的金额：验收驳回（rejected）保留可追溯但不计入已交付金额。 */
const deliveriesTotal = computed(() =>
  deliveries.value
    .filter((delivery) => delivery.status !== 'rejected')
    .reduce((sum, delivery) => sum + toNumber(delivery.amount, 0), 0),
)

/** 交付金额是否已达到合同金额（合同金额为 0 时视为无可交付空间）。 */
const deliveryDone = computed(() => {
  if (!props.contract) return true
  return toNumber(props.contract.deliveredAmount, 0) >= toNumber(props.contract.amount, 0)
})

/**
 * 错位差额的方向化解释（预收 / 应收 / 预付 / 应付 / 钱货两清 / 无执行数据）。
 * @returns {{type:string, title:string, text:string}|null}
 */
const gapInfo = computed(() => {
  const contract = props.contract
  if (!contract) return null
  const gap = Math.abs(toNumber(contract.executionGap, 0))
  const gapText = formatMoney(gap, precision.value)
  const purchase = direction.value === 'purchase'
  if (contract.gapState === 'prepaid') {
    const undelivered = formatMoney(
      Math.max(0, toNumber(contract.amount, 0) - toNumber(contract.deliveredAmount, 0)),
      precision.value,
    )
    return purchase
      ? { type: 'warning', title: '错位差额', text: `多付 ${gapText}，属于预付，尚有 ${undelivered} 未到货。` }
      : { type: 'warning', title: '错位差额', text: `多收 ${gapText}，属于预收，尚有 ${undelivered} 未交付。` }
  }
  if (contract.gapState === 'receivable') {
    const unpaidText = formatMoney(toNumber(contract.unpaid, 0), precision.value)
    return purchase
      ? { type: 'warning', title: '错位差额', text: `已到货未付款 ${gapText}，尚有 ${unpaidText} 未付。` }
      : { type: 'warning', title: '错位差额', text: `已交付未收款 ${gapText}，尚有 ${unpaidText} 未收。` }
  }
  if (contract.gapState === 'balanced') {
    return { type: 'success', title: '错位差额', text: '钱货两清：已收/已付金额与已交付金额一致。' }
  }
  return { type: 'info', title: '错位差额', text: '无执行数据：尚未登记资金流水或交付明细。' }
})

/** 双进度满额且仍在执行中：提示可手动完结，但绝不自动改状态。 */
const canFinish = computed(() => {
  const contract = props.contract
  return Boolean(
    contract &&
      contract.fundingPercent === 100 &&
      contract.deliveryPercent === 100 &&
      contract.statusCode === 'executing',
  )
})

const statusLogs = computed(() => {
  if (!props.contract || !Array.isArray(props.contract.statusLogs)) return []
  return props.contract.statusLogs
    .slice()
    .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
})

function tagStyle(color) {
  return {
    '--el-tag-text-color': color || '#409EFF',
    '--el-tag-border-color': color || '#409EFF',
    '--el-tag-bg-color': 'transparent',
  }
}

function statusColor(code) {
  return ledger.statusMap.value.get(code)?.color || '#909399'
}

function toName(code) {
  if (!code) return '—'
  return ledger.statusMap.value.get(code)?.name || code
}

function fromName(code) {
  if (!code) return '创建'
  return ledger.statusMap.value.get(code)?.name || code
}

function logType(code) {
  if (code === 'finished') return 'success'
  if (code === 'terminated') return 'danger'
  if (code === 'executing') return 'primary'
  return 'info'
}

function deliveryMeta(status) {
  return ledger.deliveryStatusMeta[status] || { name: status || '—', type: 'info' }
}

function deliveryStatusName(status) {
  return deliveryMeta(status).name
}

function deliveryTagType(status) {
  const type = deliveryMeta(status).type
  return type === 'primary' ? 'primary' : type
}

async function removePayment(payment) {
  try {
    await ElMessageBox.confirm(
      `确认删除 ${formatDate(payment.date)} 的${funding.value.verb}记录 ${formatMoney(payment.amount, precision.value)}？合同${funding.value.received}将同步回退。`,
      `删除${funding.value.verb}记录`,
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  const result = await ledger.actions.deletePayment(payment.id)
  if (result.ok) ElMessage.success(`${funding.value.verb}记录已删除，合同${funding.value.received}已回退`)
  else ElMessage.error(result.message || '删除失败')
}

async function runSummary() {
  if (!aiReady.value || !props.contract) return
  aiLoading.value = 'summary'
  try {
    const result = await summarize(props.contract, ledger.aiConfig.value)
    if (result.ok && result.data && result.data.summary) {
      ElMessageBox.alert(result.data.summary, 'AI 摘要', { confirmButtonText: '关闭' })
    } else {
      ElMessage.info(result.message || 'AI 未返回摘要')
    }
  } finally {
    aiLoading.value = ''
  }
}

async function runReminder() {
  if (!aiReady.value || !props.contract) return
  aiLoading.value = 'reminder'
  try {
    const result = await draftReminder(props.contract, ledger.aiConfig.value)
    if (result.ok && result.data && result.data.body) {
      ElMessageBox.alert(result.data.body, '催收文案', { confirmButtonText: '关闭' })
    } else {
      ElMessage.info(result.message || 'AI 未返回文案')
    }
  } finally {
    aiLoading.value = ''
  }
}
</script>
