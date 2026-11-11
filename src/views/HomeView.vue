<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head-text">
        <h2 class="page-title">首页看板</h2>
        <p class="page-subtitle">
          所有数字均由合同与收款流水实时计算，可与列表逐条核对；点击统计卡或提醒条可跳转到已带筛选条件的列表。
        </p>
      </div>
      <div class="page-actions">
        <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
          <span>
            <el-button type="primary" :disabled="!writable" @click="goCreate">
              <el-icon><Plus /></el-icon>
              新增合同
            </el-button>
          </span>
        </el-tooltip>
        <el-button @click="exportNow">
          <el-icon><Download /></el-icon>
          导出备份
        </el-button>
        <el-button @click="go('/settings', { section: 'backup' })">
          <el-icon><Upload /></el-icon>
          导入备份
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="ledger.backupDue.value"
      type="warning"
      show-icon
      :closable="false"
      title="该备份了"
    >
      距离上次备份已超过 {{ settings.autoBackup.intervalDays }} 天（或从未备份）。
      浏览器内数据只当本机缓存，请立即导出一份 JSON 备份。
      <div class="toolbar" style="margin-top: 8px">
        <el-button size="small" type="primary" @click="exportNow">立即导出</el-button>
        <el-button size="small" @click="go('/settings', { section: 'backup' })">备份设置</el-button>
      </div>
    </el-alert>

    <el-card v-if="ledger.data.contracts.length === 0" shadow="never">
      <el-empty description="台账还是空的：可以载入演示数据体验全部功能，或直接新增第一份合同">
        <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
          <span><el-button type="primary" :disabled="!writable" @click="goCreate">新增合同</el-button></span>
        </el-tooltip>
        <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
          <span><el-button :disabled="!writable" @click="loadDemo">载入演示数据</el-button></span>
        </el-tooltip>
      </el-empty>
    </el-card>

    <template v-else>
      <el-row :gutter="12" class="stat-grid">
        <el-col v-for="card in statCards" :key="card.key" :xs="12" :sm="8" :md="6" :lg="4" :xl="4">
          <el-card shadow="hover" class="stat-card" @click="card.query && go('/contracts', card.query)">
            <div class="stat-label">
              <el-icon><component :is="card.icon" /></el-icon>
              {{ card.label }}
            </div>
            <div class="stat-value" :class="{ 'is-money': card.money }">{{ card.value }}</div>
            <div class="stat-hint">{{ card.hint }}</div>
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :xs="24" :lg="16">
          <ChartPanel title="近 12 个月签约金额 vs 收款金额" :option="trendOption" :empty="!hasChartData" height="300px">
            <template #extra>
              <el-tag size="small" effect="plain">签约 {{ formatMoney(ledger.stats.value.totalAmount, precision) }}</el-tag>
              <el-tag size="small" type="success" effect="plain">收款 {{ formatMoney(ledger.stats.value.receivedAmount, precision) }}</el-tag>
            </template>
          </ChartPanel>
        </el-col>
        <el-col :xs="24" :lg="8">
          <ChartPanel title="合同类型金额占比" :option="typeOption" :empty="!hasChartData" height="300px" />
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :xs="24" :lg="16">
          <ReminderList
            :reminders="ledger.reminders.value"
            :precision="precision"
            :ignored-keys="ledger.ignoredKeys.value"
            @jump="jumpToContracts"
            @open="openContract"
            @ignore="ignoreReminder"
            @restore="restoreIgnored"
          />
        </el-col>
        <el-col :xs="24" :lg="8">
          <div class="page" style="gap: 12px">
            <ChartPanel title="合同状态分布" :option="statusOption" :empty="!hasChartData" height="260px" />
            <AiPlaceholder />
            <el-card shadow="never">
              <template #header>
                <div class="card-header">
                  <el-icon><Compass /></el-icon>
                  <span class="card-header-title">快捷入口</span>
                </div>
              </template>
              <div class="section-actions">
                <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
                  <span><el-button :disabled="!writable" @click="goCreate">新增合同</el-button></span>
                </el-tooltip>
                <el-button @click="exportNow">导出备份</el-button>
                <el-button @click="go('/settings', { section: 'backup' })">导入备份</el-button>
                <el-button @click="go('/dicts')">字典配置</el-button>
                <el-button @click="go('/personnel')">人员档案</el-button>
              </div>
              <p class="form-tip">
                当前存储：{{ ledger.storageInfo.value.engineLabel }}；上次备份：{{ lastBackupText }}。
              </p>
            </el-card>
          </div>
        </el-col>
      </el-row>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlarmClock,
  Calendar,
  Coin,
  Compass,
  Document,
  Download,
  Money,
  PieChart,
  Plus,
  TrendCharts,
  Upload,
  WarningFilled,
  Wallet,
} from '@element-plus/icons-vue'
import ChartPanel from '../components/ChartPanel.vue'
import ReminderList from '../components/ReminderList.vue'
import AiPlaceholder from '../components/AiPlaceholder.vue'
import { useLedger } from '../composables/useLedger'
import {
  formatCompactMoney,
  formatDateTime,
  formatMoney,
  formatPercent,
} from '../utils/format'

const ledger = useLedger()
const router = useRouter()
const settings = ledger.settings
const precision = ledger.precision
const stats = ledger.stats
const hasChartData = computed(() => ledger.data.contracts.length > 0 || ledger.data.payments.length > 0)
const writable = computed(() => ledger.storageInfo.value.writable)

const statCards = computed(() => {
  const s = stats.value
  return [
    {
      key: 'count',
      label: '合同总数',
      value: `${s.contractCount} 份`,
      hint: '点击查看全部合同',
      icon: Document,
      query: { quick: 'all' },
    },
    {
      key: 'totalAmount',
      label: '合同总金额',
      value: formatMoney(s.totalAmount, precision.value),
      hint: '所有合同金额之和',
      icon: Money,
      money: true,
      query: { quick: 'all' },
    },
    {
      key: 'received',
      label: '已收总额',
      value: formatMoney(s.receivedAmount, precision.value),
      hint: '所有合同已收金额之和',
      icon: Wallet,
      money: true,
      query: { quick: 'received' },
    },
    {
      key: 'unpaid',
      label: '未收总额',
      value: formatMoney(s.unpaidAmount, precision.value),
      hint: '存在未收金额的合同',
      icon: Coin,
      money: true,
      query: { quick: 'unpaid' },
    },
    {
      key: 'rate',
      label: '整体收款率',
      value: s.paymentRate === null ? '—' : formatPercent(s.paymentRate, 1),
      hint: '已收总额 / 合同总金额',
      icon: TrendCharts,
      query: { quick: 'unpaid' },
    },
    {
      key: 'executing',
      label: '执行中',
      value: `${s.executingCount} 份`,
      hint: '状态为执行中的合同',
      icon: AlarmClock,
      query: { quick: 'executing' },
    },
    {
      key: 'monthSigned',
      label: '本月新签',
      value: `${s.monthSignedCount} 份`,
      hint: `金额 ${formatMoney(s.monthSignedAmount, precision.value)}`,
      icon: Calendar,
      query: { quick: 'monthSigned' },
    },
    {
      key: 'dueSoon',
      label: '临期合同',
      value: `${s.dueSoonCount} 份`,
      hint: `到期日在 ${settings.value.reminderDays} 天内`,
      icon: AlarmClock,
      query: { quick: 'dueSoon' },
    },
    {
      key: 'overdue',
      label: '已逾期',
      value: `${s.overdueCount} 份`,
      hint: '已过到期日且未完结',
      icon: WarningFilled,
      query: { quick: 'overdue' },
    },
    {
      key: 'overdueUnpaid',
      label: '逾期未收金额',
      value: formatMoney(s.overdueUnpaidAmount, precision.value),
      hint: `超过 ${settings.value.overdueDays} 天未收款`,
      icon: PieChart,
      money: true,
      query: { quick: 'overdueUnpaid' },
    },
  ]
})

const trendOption = computed(() => {
  const trend = ledger.trend.value
  return {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => formatMoney(value, precision.value),
    },
    legend: { data: ['签约金额', '收款金额'], bottom: 0 },
    grid: { left: 12, right: 20, top: 24, bottom: 42, containLabel: true },
    xAxis: {
      type: 'category',
      data: trend.labels,
      axisLabel: { formatter: (value) => String(value).slice(2) },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value) => formatCompactMoney(value) },
    },
    series: [
      {
        name: '签约金额',
        type: 'bar',
        data: trend.signed,
        barMaxWidth: 18,
        itemStyle: { color: '#2f6feb', borderRadius: [3, 3, 0, 0] },
      },
      {
        name: '收款金额',
        type: 'line',
        data: trend.received,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: '#2f9e63' },
        areaStyle: { opacity: 0.12, color: '#2f9e63' },
      },
    ],
  }
})

const typeOption = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (params) =>
      `${params.name}<br/>${formatMoney(params.value, precision.value)}（${params.percent}%）`,
  },
  legend: { bottom: 0, type: 'scroll' },
  series: [
    {
      type: 'pie',
      radius: ['42%', '66%'],
      center: ['50%', '44%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
      label: { show: true, formatter: '{b}\n{d}%' },
      data: ledger.typeDistribution.value.map((item) => ({
        name: item.name,
        value: item.amount,
        itemStyle: { color: item.color },
      })),
    },
  ],
}))

const statusOption = computed(() => {
  const list = ledger.statusDistribution.value
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 32, top: 16, bottom: 20, containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: list.map((item) => item.name) },
    series: [
      {
        type: 'bar',
        barMaxWidth: 18,
        label: { show: true, position: 'right' },
        data: list.map((item) => ({
          value: item.count,
          itemStyle: { color: item.color, borderRadius: [0, 3, 3, 0] },
        })),
      },
    ],
  }
})

const lastBackupText = computed(() => formatDateTime(ledger.data.meta.lastBackupAt, '尚未备份'))

function go(path, query) {
  router.push(query ? { path, query } : { path })
}

function goCreate() {
  go('/contracts', { action: 'create' })
}

function jumpToContracts(quick) {
  go('/contracts', { quick })
}

function openContract(id) {
  go('/contracts', { detail: id })
}

async function ignoreReminder(key) {
  const result = await ledger.actions.ignoreReminder(key)
  if (result.ok) ElMessage.success('已忽略该提醒（未删除任何数据）')
  else ElMessage.error(result.message || '忽略失败')
}

async function restoreIgnored() {
  const result = await ledger.actions.restoreIgnoredReminders()
  if (result.ok) ElMessage.success('已恢复全部被忽略的提醒')
  else ElMessage.error(result.message || '恢复失败')
}

async function exportNow() {
  const result = await ledger.actions.exportBackup()
  if (!result.ok) {
    ElMessage.error(result.message || '导出失败')
    return
  }
  if (result.warning) ElMessage.warning(result.warning)
  else ElMessage.success(`已导出 ${result.fileName}`)
}

async function loadDemo() {
  try {
    await ElMessageBox.confirm('将用 15 条演示数据替换当前数据，建议先导出备份。', '载入演示数据', {
      confirmButtonText: '载入',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const result = await ledger.actions.loadDemoData()
  if (result.ok) ElMessage.success('演示数据已载入')
  else ElMessage.error(result.message || '载入失败')
}
</script>
