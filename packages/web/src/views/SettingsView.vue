<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head-text">
        <h2 class="page-title">系统设置</h2>
        <p class="page-subtitle">
          全局提醒参数、合同编号规则、自动备份周期、存储引擎状态与 AI 预留配置。
          所有设置保存在本机存储中，并随备份一起导出（AI 密钥除外）。
        </p>
      </div>
    </div>

    <!-- 存储状态 -->
    <el-card shadow="never" class="settings-card">
      <template #header>
        <div class="card-header">
          <el-icon><Coin /></el-icon>
          <span class="card-header-title">存储状态</span>
          <div class="card-header-spacer" />
          <el-tag :type="writable ? 'success' : 'danger'" effect="plain" size="small">
            {{ writable ? '可写' : '只读' }}
          </el-tag>
        </div>
      </template>

      <StorageStatus :columns="isNarrow ? 1 : 2" />

      <div class="section-actions" style="margin-top: 14px">
        <el-button :loading="refreshing" @click="reloadData">
          <el-icon><Refresh /></el-icon>
          从服务刷新数据
        </el-button>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 12px"
        title="本地服务存储"
      >
        数据由本地服务独占管理（SQLite，WAL 模式，data/ledger.db）：所有写入经领域命令在单事务内提交，失败整体回滚。
        服务只监听 127.0.0.1，运行期零外部网络请求。数据库不可写时服务进入只读模式，写入入口自动禁用，浏览与导出不受影响。
      </el-alert>
    </el-card>

    <!-- 常规设置 -->
    <el-card shadow="never" class="settings-card">
      <template #header>
        <div class="card-header">
          <el-icon><Setting /></el-icon>
          <span class="card-header-title">常规设置</span>
          <div class="card-header-spacer" />
          <el-tag v-if="generalDirty" type="warning" effect="plain" size="small">有未保存修改</el-tag>
        </div>
      </template>

      <el-form
        ref="generalFormRef"
        :model="general"
        :rules="generalRules"
        label-position="top"
        class="settings-form"
      >
        <el-form-item label="操作人名称" prop="operatorName">
          <el-input v-model="general.operatorName" maxlength="30" placeholder="写入状态变更日志的操作人" />
          <p class="form-tip">用于状态变更日志与转交操作日志，默认「本机用户」。</p>
        </el-form-item>
        <el-form-item label="到期提醒提前天数" prop="reminderDays">
          <el-input-number v-model="general.reminderDays" :min="0" :max="365" :step="5" controls-position="right" />
          <p class="form-tip">默认 30 天；首页「临期合同」与提醒清单按此计算。</p>
        </el-form-item>
        <el-form-item label="逾期未收判定天数" prop="overdueDays">
          <el-input-number v-model="general.overdueDays" :min="0" :max="365" :step="1" controls-position="right" />
          <p class="form-tip">默认 0（到期即判）；基于「最近收款日 / 到期日 + N 天」判断逾期未收。</p>
        </el-form-item>
        <el-form-item label="状态长期未变更天数" prop="staleDays">
          <el-input-number v-model="general.staleDays" :min="1" :max="3650" :step="10" controls-position="right" />
          <p class="form-tip">默认 90 天；执行中合同超过该天数未变更状态会进入提醒清单。</p>
        </el-form-item>
        <el-form-item label="金额小数位" prop="amountPrecision">
          <el-input-number v-model="general.amountPrecision" :min="0" :max="4" :step="1" controls-position="right" />
          <p class="form-tip">默认 2 位；影响金额输入、展示与校验精度。</p>
        </el-form-item>
        <el-form-item label="每页条数" prop="pageSize">
          <el-input-number v-model="general.pageSize" :min="5" :max="200" :step="5" controls-position="right" />
          <p class="form-tip">默认 20 条；列表页初始分页大小。</p>
        </el-form-item>
        <el-form-item label="合同编号自动生成">
          <el-switch v-model="general.autoNoEnabled" inline-prompt active-text="开启" inactive-text="关闭" />
          <div class="field-stack">
            <el-input
              v-model="general.autoNoPattern"
              :disabled="!general.autoNoEnabled"
              maxlength="40"
              placeholder="HT-YYYYMM-###"
            />
          </div>
          <p class="form-tip">
            占位符：YYYY（年）、MM（月）、DD（日）、###（三位序号）。默认 HT-YYYYMM-###，可在表单中手工覆盖。
          </p>
        </el-form-item>
        <el-form-item label="自动备份提醒">
          <el-switch v-model="general.autoBackupEnabled" inline-prompt active-text="开启" inactive-text="关闭" />
          <div class="field-stack">
            <el-input-number
              v-model="general.autoBackupDays"
              :min="1"
              :max="365"
              :step="1"
              :disabled="!general.autoBackupEnabled"
              controls-position="right"
            />
            <span class="small muted" style="margin-left: 8px">天</span>
          </div>
          <p class="form-tip">默认开启、每 7 天；到期时首页显示温和提示条（不会自动下载文件）。</p>
        </el-form-item>
      </el-form>

      <div class="section-actions">
        <el-tooltip content="设置写入将在后续版本开放" placement="top">
          <span>
            <el-button type="primary" disabled :loading="savingGeneral" @click="saveGeneral">保存设置</el-button>
          </span>
        </el-tooltip>
        <el-button @click="restoreDefaults">恢复默认值（不保存）</el-button>
        <p class="form-tip">
          服务端暂无设置写命令：本页设置为只读（来自导出备份的 settings.app），修改不会保存。业务设置调整请经导入备份完成。
        </p>
      </div>
    </el-card>

    <!-- 备份与恢复 -->
    <div ref="backupSection">
      <BackupPanel />
    </div>

    <!-- AI 配置 -->
    <div ref="aiSection">
      <el-card shadow="never" class="settings-card ai-card">
      <template #header>
        <div class="card-header">
          <el-icon><MagicStick /></el-icon>
          <span class="card-header-title">AI 配置（能力预留）</span>
          <div class="card-header-spacer" />
          <el-tag :type="aiReady ? 'success' : 'info'" effect="plain" size="small">
            {{ aiReady ? '已配置（占位实现）' : '未配置' }}
          </el-tag>
        </div>
      </template>

      <el-alert type="info" :closable="false" show-icon title="默认不发起任何网络请求">
        未配置 AI 时应用完全可用且零外部请求。接入真实模型只需三步：填写本页配置 → 替换
        src/ai/provider.js 中的 complete() 实现 → 打开总开关。
        API Key 与 Base URL 不会出现在导出备份中。
      </el-alert>

      <el-form :model="aiForm" label-position="top" class="settings-form settings-form-sub">
        <el-form-item label="总开关">
          <el-switch v-model="aiForm.enabled" inline-prompt active-text="启用" inactive-text="关闭" />
        </el-form-item>
        <el-form-item label="服务商">
          <el-select v-model="aiForm.provider">
            <el-option v-for="item in aiProviders" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL">
          <el-input v-model="aiForm.baseUrl" maxlength="200" placeholder="例如 https://api.example.com/v1" />
        </el-form-item>
        <el-form-item label="模型名">
          <el-input v-model="aiForm.model" maxlength="80" placeholder="例如 gpt-4o-mini" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="aiForm.apiKey"
            type="password"
            show-password
            maxlength="200"
            placeholder="仅保存在本机，导出备份时强制剔除"
            autocomplete="off"
          />
        </el-form-item>
        <el-form-item label="超时（秒）">
          <el-input-number v-model="aiForm.timeout" :min="5" :max="120" :step="5" controls-position="right" />
        </el-form-item>
        <el-form-item label="温度">
          <el-slider v-model="aiForm.temperature" :min="0" :max="1" :step="0.1" show-input />
        </el-form-item>
      </el-form>

      <div class="section-actions">
        <el-tooltip content="设置写入将在后续版本开放" placement="top">
          <span>
            <el-button type="primary" disabled :loading="savingAi" @click="saveAi">保存 AI 配置</el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="aiReady" content="请在设置中配置 AI 后使用" placement="top">
          <span>
            <el-button :disabled="!aiReady" :loading="testingAi" @click="testAi">测试连通性</el-button>
          </span>
        </el-tooltip>
      </div>
      <p class="form-tip">
        本页 AI 配置只读（导出备份已剔除密钥）；保存入口将在服务端提供设置写命令后开放。
        测试连通性在未配置时禁用；即使已配置，当前占位实现也不会发起网络请求，只会如实提示。
      </p>
      </el-card>
    </div>

    <!-- 操作日志 -->
    <el-card shadow="never" class="settings-card">
      <template #header>
        <div class="card-header">
          <el-icon><Document /></el-icon>
          <span class="card-header-title">操作日志（最近 20 条）</span>
          <div class="card-header-spacer" />
          <span class="small muted">审计记录由本地服务在写入事务内保存（audit_log）</span>
        </div>
      </template>
      <el-table :data="opLogs" size="small" border>
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.at) }}</template>
        </el-table-column>
        <el-table-column prop="by" label="操作人" width="120" />
        <el-table-column prop="detail" label="内容" min-width="260" show-overflow-tooltip />
        <el-table-column prop="action" label="动作" width="160" />
        <template #empty>
          <el-empty description="暂无操作日志" :image-size="70" />
        </template>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Coin,
  Document,
  MagicStick,
  Refresh,
  Setting,
} from '@element-plus/icons-vue'
import StorageStatus from '../components/StorageStatus.vue'
import BackupPanel from '../components/BackupPanel.vue'
import { useLedger } from '../composables/useLedger'
import { useMediaQuery } from '../composables/useMediaQuery'
import { AI_PROVIDERS, complete } from '../ai/provider'
import { createSettings } from '../data/schema'
import { formatDateTime } from '../utils/format'

const ledger = useLedger()
const route = useRoute()
const isNarrow = useMediaQuery('(max-width: 1023px)')
const writable = computed(() => ledger.storageInfo.value.writable)
const aiReady = computed(() => ledger.aiReady.value)
const aiProviders = AI_PROVIDERS

const generalFormRef = ref(null)
const general = reactive({
  operatorName: '',
  reminderDays: 30,
  overdueDays: 0,
  staleDays: 90,
  amountPrecision: 2,
  pageSize: 20,
  autoNoEnabled: true,
  autoNoPattern: 'HT-YYYYMM-###',
  autoBackupEnabled: true,
  autoBackupDays: 7,
})
const loadedGeneralKey = ref('')
const savingGeneral = ref(false)

function serializeGeneral() {
  return JSON.stringify(general)
}

const generalDirty = computed(() => serializeGeneral() !== loadedGeneralKey.value)

function loadGeneral() {
  const settings = ledger.settings.value
  Object.assign(general, {
    operatorName: settings.operatorName || '本机用户',
    reminderDays: Number(settings.reminderDays),
    overdueDays: Number(settings.overdueDays),
    staleDays: Number(settings.staleDays),
    amountPrecision: Number(settings.amountPrecision),
    pageSize: Number(settings.pageSize),
    autoNoEnabled: settings.autoNo?.enabled !== false,
    autoNoPattern: settings.autoNo?.pattern || 'HT-YYYYMM-###',
    autoBackupEnabled: settings.autoBackup?.enabled !== false,
    autoBackupDays: Number(settings.autoBackup?.intervalDays) || 7,
  })
  loadedGeneralKey.value = serializeGeneral()
}

loadGeneral()

watch(
  () => JSON.stringify(ledger.settings.value),
  () => {
    if (!generalDirty.value) loadGeneral()
  },
)

const generalRules = {
  operatorName: [{ required: true, message: '操作人名称不能为空', trigger: 'blur' }],
  reminderDays: [
    {
      validator: (_rule, value, callback) => {
        const n = Number(value)
        if (!Number.isFinite(n) || n < 0 || n > 365) return callback(new Error('需在 0 ~ 365 之间'))
        callback()
      },
      trigger: 'change',
    },
  ],
  overdueDays: [
    {
      validator: (_rule, value, callback) => {
        const n = Number(value)
        if (!Number.isFinite(n) || n < 0 || n > 365) return callback(new Error('需在 0 ~ 365 之间'))
        callback()
      },
      trigger: 'change',
    },
  ],
  staleDays: [
    {
      validator: (_rule, value, callback) => {
        const n = Number(value)
        if (!Number.isFinite(n) || n < 1 || n > 3650) return callback(new Error('需在 1 ~ 3650 之间'))
        callback()
      },
      trigger: 'change',
    },
  ],
  amountPrecision: [
    {
      validator: (_rule, value, callback) => {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 0 || n > 4) return callback(new Error('需为 0 ~ 4 的整数'))
        callback()
      },
      trigger: 'change',
    },
  ],
  pageSize: [
    {
      validator: (_rule, value, callback) => {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 5 || n > 200) return callback(new Error('需为 5 ~ 200 的整数'))
        callback()
      },
      trigger: 'change',
    },
  ],
  autoNoPattern: [
    {
      validator: (_rule, value, callback) => {
        if (!general.autoNoEnabled) return callback()
        if (!value || !String(value).includes('###')) {
          return callback(new Error('编号规则需包含 ### 作为三位序号占位符'))
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
}

async function saveGeneral() {
  if (!generalFormRef.value) return
  try {
    await generalFormRef.value.validate()
  } catch {
    ElMessage.warning('请检查设置项的取值范围')
    return
  }
  savingGeneral.value = true
  try {
    const result = await ledger.actions.saveSettings({
      operatorName: general.operatorName,
      reminderDays: Number(general.reminderDays),
      overdueDays: Number(general.overdueDays),
      staleDays: Number(general.staleDays),
      amountPrecision: Number(general.amountPrecision),
      pageSize: Number(general.pageSize),
      autoNo: { enabled: general.autoNoEnabled, pattern: general.autoNoPattern },
      autoBackup: { enabled: general.autoBackupEnabled, intervalDays: Number(general.autoBackupDays) },
    })
    if (result.ok) {
      ElMessage.success('设置已保存')
      await nextTick()
      loadedGeneralKey.value = serializeGeneral()
    } else {
      ElMessage.error(result.message || '保存设置失败')
    }
  } finally {
    savingGeneral.value = false
  }
}

function restoreDefaults() {
  const defaults = createSettings()
  Object.assign(general, {
    operatorName: defaults.operatorName,
    reminderDays: defaults.reminderDays,
    overdueDays: defaults.overdueDays,
    staleDays: defaults.staleDays,
    amountPrecision: defaults.amountPrecision,
    pageSize: defaults.pageSize,
    autoNoEnabled: defaults.autoNo.enabled,
    autoNoPattern: defaults.autoNo.pattern,
    autoBackupEnabled: defaults.autoBackup.enabled,
    autoBackupDays: defaults.autoBackup.intervalDays,
  })
  ElMessage.info('已填入默认值，点击「保存设置」后生效')
}

// ---------- AI ----------
const aiForm = reactive({
  enabled: false,
  provider: 'custom',
  baseUrl: '',
  model: '',
  apiKey: '',
  timeout: 30,
  temperature: 0.3,
})
const savingAi = ref(false)
const testingAi = ref(false)

function loadAi() {
  const config = ledger.aiConfig.value || {}
  Object.assign(aiForm, {
    enabled: config.enabled === true,
    provider: config.provider || 'custom',
    baseUrl: config.baseUrl || '',
    model: config.model || '',
    apiKey: config.apiKey || '',
    timeout: Number(config.timeout) || 30,
    temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.3,
  })
}

loadAi()
watch(
  () => JSON.stringify(ledger.aiConfig.value),
  () => loadAi(),
)

async function saveAi() {
  savingAi.value = true
  try {
    const result = await ledger.actions.saveAiConfig({
      enabled: aiForm.enabled,
      provider: aiForm.provider,
      baseUrl: aiForm.baseUrl.trim(),
      model: aiForm.model.trim(),
      apiKey: aiForm.apiKey,
      timeout: Number(aiForm.timeout),
      temperature: Number(aiForm.temperature),
    })
    if (result.ok) {
      ElMessage.success(
        aiForm.enabled ? 'AI 配置已保存（占位实现不会发起网络请求）' : 'AI 配置已保存，总开关处于关闭状态',
      )
    } else {
      ElMessage.error(result.message || '保存 AI 配置失败')
    }
  } finally {
    savingAi.value = false
  }
}

async function testAi() {
  if (!aiReady.value) return
  testingAi.value = true
  try {
    const result = await complete('connectivity-check', { purpose: 'test' }, ledger.aiConfig.value)
    if (result.ok) ElMessage.success('AI 配置可用（当前实现未发起真实请求）')
    else ElMessage.info(result.message || 'AI 配置尚不可用')
  } finally {
    testingAi.value = false
  }
}

// ---------- 数据刷新 ----------
const refreshing = ref(false)

async function reloadData() {
  refreshing.value = true
  try {
    await ledger.actions.refresh()
    loadGeneral()
    ElMessage.success('已从服务刷新数据')
  } catch (error) {
    ElMessage.error(`刷新失败：${error && error.message ? error.message : String(error)}`)
  } finally {
    refreshing.value = false
  }
}

// ---------- 操作日志 ----------
const opLogs = computed(() => {
  const logs = Array.isArray(ledger.data.meta.opLogs) ? ledger.data.meta.opLogs : []
  return logs.slice().reverse().slice(0, 20)
})

// ---------- 锚点 ----------
const aiSection = ref(null)
const backupSection = ref(null)

onMounted(() => {
  const section = route.query.section
  const target = section === 'ai' ? aiSection.value : section === 'backup' ? backupSection.value : null
  if (target) {
    nextTick(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
})
</script>
