<template>
  <div v-if="compact" class="storage-status-compact">
    <el-tooltip :content="engineTip" placement="top">
      <el-tag :type="engineTagType" effect="plain" size="small">
        <span class="storage-dot" :class="dotClass" />
        {{ info.engineLabel }}
      </el-tag>
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
      <el-descriptions-item label="服务版本">{{ info.server?.version || '—' }}</el-descriptions-item>
      <el-descriptions-item label="Schema 版本">{{ info.server?.schemaVersion || '—' }}</el-descriptions-item>
      <el-descriptions-item label="合同 / 收款">
        {{ info.counts.contracts }} 份 / {{ info.counts.payments }} 条
      </el-descriptions-item>
      <el-descriptions-item label="交付 / 人员">
        {{ info.counts.deliveries }} 条 / {{ info.counts.personnel }} 名
      </el-descriptions-item>
      <el-descriptions-item label="字典 / 设置">
        {{ info.counts.dicts }} 项 / {{ info.settingsCount }} 组
      </el-descriptions-item>
      <el-descriptions-item label="上次备份">{{ lastBackupText }}</el-descriptions-item>
      <el-descriptions-item label="上次导入">{{ lastImportText }}</el-descriptions-item>
      <el-descriptions-item label="运行方式">
        <el-tag type="success" effect="plain" size="small">本地服务（127.0.0.1）</el-tag>
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
      title="服务提示"
    >
      {{ info.lastError }}
    </el-alert>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatDateTime } from '../utils/format'
import { useLedger } from '../composables/useLedger'

const props = defineProps({
  compact: { type: Boolean, default: false },
  columns: { type: Number, default: 2 },
})

const ledger = useLedger()
const info = ledger.storageInfo
const descriptionColumns = computed(() => (props.columns >= 1 ? props.columns : 2))

const engineTagType = computed(() => (info.value.writable ? 'success' : 'danger'))

const dotClass = computed(() => (info.value.writable ? '' : 'is-danger'))

const engineTip = computed(() => {
  if (!info.value.writable) return '本地服务当前只读：仅可浏览与导出'
  return '本地服务（SQLite 单事务写入）：数据保存在 data/ledger.db，服务只监听 127.0.0.1'
})

const lastBackupText = computed(() => formatDateTime(ledger.data.meta.lastBackupAt, '尚未备份'))
const lastImportText = computed(() => formatDateTime(ledger.data.meta.lastImportAt, '尚未导入'))
</script>
