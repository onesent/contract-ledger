<template>
  <div v-if="compact" class="storage-status-compact">
    <el-tooltip :content="engineTip" placement="top">
      <el-tag :type="engineTagType" effect="plain" size="small">
        <span class="storage-dot" :class="dotClass" />
        {{ info.engineLabel }}
      </el-tag>
    </el-tooltip>
    <el-tooltip :content="capacityTip" placement="top">
      <el-tag type="info" effect="plain" size="small">已用 {{ usedText }}</el-tag>
    </el-tooltip>
    <span class="storage-counts small">
      合同 <b>{{ info.counts.contracts }}</b>
      收款 <b>{{ info.counts.payments }}</b>
      人员 <b>{{ info.counts.personnel }}</b>
      字典 <b>{{ info.counts.dicts }}</b>
    </span>
  </div>

  <div v-else class="storage-status">
    <el-descriptions :column="descriptionColumns" border size="small">
      <el-descriptions-item label="存储引擎">
        <el-tooltip :content="engineTip" placement="top">
          <el-tag :type="engineTagType" effect="plain">
            <span class="storage-dot" :class="dotClass" />
            {{ info.engineLabel }}
          </el-tag>
        </el-tooltip>
        <el-tag v-if="!info.writable" type="danger" effect="plain" style="margin-left: 6px">只读</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="可写状态">
        <el-tooltip :content="info.writable ? '可正常保存数据' : '所有写入入口已禁用，仅可浏览与导出'">
          <el-tag :type="info.writable ? 'success' : 'danger'" effect="plain">
            {{ info.writable ? '可写' : '只读' }}
          </el-tag>
        </el-tooltip>
      </el-descriptions-item>
      <el-descriptions-item label="已用容量">{{ capacityText }}</el-descriptions-item>
      <el-descriptions-item label="数据体积">{{ usedText }}</el-descriptions-item>
      <el-descriptions-item label="合同 / 收款">
        {{ info.counts.contracts }} 份 / {{ info.counts.payments }} 条
      </el-descriptions-item>
      <el-descriptions-item label="人员 / 字典">
        {{ info.counts.personnel }} 名 / {{ info.counts.dicts }} 项
      </el-descriptions-item>
      <el-descriptions-item label="设置 / meta">1 组 / 1 条</el-descriptions-item>
      <el-descriptions-item label="上次备份">{{ lastBackupText }}</el-descriptions-item>
      <el-descriptions-item label="上次导入">{{ lastImportText }}</el-descriptions-item>
      <el-descriptions-item label="运行方式">
        <el-tag :type="info.portable ? 'warning' : 'success'" effect="plain" size="small">
          {{ info.portable ? '便携模式（file://）' : 'localhost / 正式站点' }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="IndexedDB">
        <el-tag :type="info.idbAvailable ? 'success' : 'info'" effect="plain" size="small">
          {{ info.idbAvailable ? '可用' : '不可用' }}
        </el-tag>
        <span v-if="!info.idbAvailable && info.idbError" class="small muted" style="margin-left: 6px">
          {{ info.idbError }}
        </span>
      </el-descriptions-item>
    </el-descriptions>

    <el-alert
      v-if="info.writeError"
      type="error"
      show-icon
      :closable="false"
      style="margin-top: 12px"
      title="最近一次写入失败"
    >
      {{ info.writeError.message }}
    </el-alert>
    <el-alert
      v-else-if="info.lastError"
      type="warning"
      show-icon
      :closable="false"
      style="margin-top: 12px"
      title="存储提示"
    >
      {{ info.lastError }}
    </el-alert>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatDateTime, formatStorage } from '../utils/format'
import { useLedger } from '../composables/useLedger'

const props = defineProps({
  compact: { type: Boolean, default: false },
  columns: { type: Number, default: 2 },
})

const ledger = useLedger()
const info = ledger.storageInfo
const descriptionColumns = computed(() => (props.columns >= 1 ? props.columns : 2))

const engineTagType = computed(() => {
  if (!info.value.writable) return 'danger'
  if (info.value.engine === 'indexeddb') return 'success'
  return 'warning'
})

const dotClass = computed(() => {
  if (!info.value.writable) return 'is-danger'
  if (info.value.engine === 'indexeddb') return ''
  return 'is-warning'
})

const engineTip = computed(() => {
  if (info.value.engine === 'indexeddb') return 'IndexedDB：事务写入，刷新 / 重启浏览器后数据保留'
  if (info.value.engine === 'localstorage') return 'localStorage 降级：仅适合小规模数据，写满时停止录入'
  return '内存只读模式：仅可浏览与导出'
})

const usedBytes = computed(() => {
  const usage = info.value.usage || {}
  // 内存只读模式没有持久化数据，直接展示数据体积，避免把浏览器全局占用误报为本应用已用容量
  if (info.value.engine === 'memory') return usage.bytes ?? null
  return usage.usage ?? usage.bytes ?? null
})

const usedText = computed(() => formatStorage(usedBytes.value))

const capacityText = computed(() => {
  const usage = info.value.usage || {}
  if (usedBytes.value === null) return '未知'
  if (usage.quota) return `${formatStorage(usedBytes.value)} / ${formatStorage(usage.quota)}`
  return `${formatStorage(usedBytes.value)}（配额未知）`
})

const capacityTip = computed(() => `数据体积 ${usedText.value}；容量由浏览器统一分配`)

const lastBackupText = computed(() => formatDateTime(ledger.data.meta.lastBackupAt, '尚未备份'))
const lastImportText = computed(() => formatDateTime(ledger.data.meta.lastImportAt, '尚未导入'))
</script>
