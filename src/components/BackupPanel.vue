<template>
  <el-card shadow="never" class="settings-card">
    <template #header>
      <div class="card-header">
        <el-icon><FolderOpened /></el-icon>
        <span class="card-header-title">备份与恢复</span>
        <div class="card-header-spacer" />
        <span class="small muted">
          上次备份：{{ formatDateTime(meta.lastBackupAt, '尚未备份') }}
          <span v-if="meta.lastImportAt"> · 上次导入：{{ formatDateTime(meta.lastImportAt) }}</span>
        </span>
      </div>
    </template>

    <el-alert type="info" :closable="false" show-icon title="导出 JSON 才是真正的存档">
      浏览器内数据只当本机缓存：清除站点数据、换浏览器、无痕模式、便携模式移动文件路径都可能导致丢失。
      备份包含合同、收款流水、人员、字典与设置，并强制剔除 API Key / Base URL 等密钥字段。
    </el-alert>

    <div class="section-actions" style="margin-top: 14px">
      <el-button type="primary" @click="exportVisible = true">
        <el-icon><Download /></el-icon>
        导出备份
      </el-button>
      <el-button @click="downloadSnapshotOnly">
        <el-icon><DocumentCopy /></el-icon>
        下载当前快照
      </el-button>
      <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
        <span>
          <el-button type="danger" plain :disabled="!writable" @click="clearAll">
            <el-icon><Delete /></el-icon>
            清空全部数据
          </el-button>
        </span>
      </el-tooltip>
      <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
        <span>
          <el-button :disabled="!writable" @click="loadDemo">
            <el-icon><RefreshLeft /></el-icon>
            恢复演示数据
          </el-button>
        </span>
      </el-tooltip>
    </div>

    <h4 style="margin: 18px 0 8px">导入备份</h4>
    <el-upload
      ref="uploadRef"
      drag
      :auto-upload="false"
      :before-upload="() => false"
      :on-change="onFileChange"
      :show-file-list="false"
      :disabled="!writable"
      accept=".json,application/json"
    >
      <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
      <div class="el-upload__text">拖拽备份 JSON 到这里，或 <em>点击选择文件</em></div>
      <template #tip>
        <div class="el-upload__tip">
          导入流程：结构 / 版本 / 字段校验 → 选择覆盖或合并 → 自动下载当前数据快照 → 事务写入（失败整体回滚，现有数据不受影响）。
        </div>
      </template>
    </el-upload>

    <p class="form-tip">
      覆盖导入会用备份整体替换现有数据；合并导入按 id 去重，冲突时取 updatedAt 较新者。
      两种方式都会在写入前自动下载一份当前数据快照。
    </p>

    <!-- 导出确认 -->
    <el-dialog v-model="exportVisible" title="导出备份" width="560px" append-to-body>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="合同">{{ counts.contracts }} 份</el-descriptions-item>
        <el-descriptions-item label="收款流水">{{ counts.payments }} 条</el-descriptions-item>
        <el-descriptions-item label="人员">{{ counts.personnel }} 名</el-descriptions-item>
        <el-descriptions-item label="字典项">{{ counts.dicts }} 项</el-descriptions-item>
        <el-descriptions-item label="设置" :span="2">1 组（含字典分类、提醒参数、列显隐；AI 密钥已剔除）</el-descriptions-item>
      </el-descriptions>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="导出内容说明"
        style="margin-top: 12px"
      >
        文件名形如「合同台账备份_YYYYMMDD_HHmm.json」。包含字典、人员与设置；
        API Key 与 Base URL 已剔除，不会写入备份文件。导出成功后会更新 meta.lastBackupAt。
      </el-alert>
      <template #footer>
        <el-button @click="exportVisible = false">取消</el-button>
        <el-button type="primary" :loading="exporting" @click="confirmExport">确认导出</el-button>
      </template>
    </el-dialog>

    <!-- 校验失败详情 -->
    <el-dialog v-model="errorVisible" title="备份文件校验失败" width="640px" append-to-body>
      <el-alert
        type="error"
        :closable="false"
        show-icon
        :title="`发现 ${importErrors.length} 个问题，现有数据未被修改`"
      />
      <ul class="import-error-list">
        <li v-for="(item, index) in importErrors.slice(0, 50)" :key="index">{{ item }}</li>
      </ul>
      <p v-if="importErrors.length > 50" class="form-tip">仅展示前 50 条。</p>
      <template #footer>
        <el-button type="primary" @click="errorVisible = false">知道了</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { computed, h, ref } from 'vue'
import {
  Delete,
  DocumentCopy,
  Download,
  FolderOpened,
  RefreshLeft,
  UploadFilled,
} from '@element-plus/icons-vue'
import { useLedger } from '../composables/useLedger'
import { readFileText } from '../data/backup'
import { formatDateTime, formatStorage } from '../utils/format'

const ledger = useLedger()
const meta = ledger.meta
const counts = computed(() => ({
  contracts: ledger.data.contracts.length,
  payments: ledger.data.payments.length,
  personnel: ledger.data.personnel.length,
  dicts: ledger.data.dicts.length,
}))
const writable = computed(() => ledger.storageInfo.value.writable)

const uploadRef = ref(null)
const exportVisible = ref(false)
const exporting = ref(false)
const errorVisible = ref(false)
const importErrors = ref([])

async function confirmExport() {
  exporting.value = true
  try {
    const result = await ledger.actions.exportBackup()
    if (result.ok) {
      exportVisible.value = false
      if (result.warning) ElMessage.warning(result.warning)
      else ElMessage.success(`已导出 ${result.fileName}（${formatStorage(result.bytes)}）`)
    } else {
      ElMessage.error(result.message || '导出失败')
    }
  } finally {
    exporting.value = false
  }
}

async function downloadSnapshotOnly() {
  try {
    const result = await ledger.actions.exportSnapshot()
    ElMessage.success(`已下载当前数据快照：${result.fileName}`)
  } catch (error) {
    ElMessage.error(`快照下载失败：${error && error.message ? error.message : String(error)}`)
  }
}

function resetUpload() {
  if (uploadRef.value && typeof uploadRef.value.clearFiles === 'function') {
    uploadRef.value.clearFiles()
  }
}

async function onFileChange(uploadFile) {
  const raw = uploadFile && uploadFile.raw
  if (!raw) return
  if (!/\.json$/i.test(raw.name)) {
    ElMessage.error('请选择 .json 备份文件')
    resetUpload()
    return
  }
  if (!writable.value) {
    ElMessage.error('当前为只读模式，无法导入')
    resetUpload()
    return
  }

  const read = await readFileText(raw)
  resetUpload()
  if (!read.ok) {
    ElMessage.error(read.message || '文件读取失败')
    return
  }

  const parsed = ledger.actions.parseBackup(read.text)
  if (!parsed.ok) {
    importErrors.value = parsed.errors
    errorVisible.value = true
    ElMessage.error(parsed.message || '备份文件校验失败')
    return
  }
  if (parsed.warnings && parsed.warnings.length) {
    ElMessage.warning(`校验提醒：${parsed.warnings.slice(0, 2).join('；')}`)
  }

  let mode = ''
  try {
    await ElMessageBox({
      title: '选择导入方式',
      message: h('div', { style: 'line-height: 1.9; font-size: 13px' }, [
        h('p', `文件：${raw.name}`),
        h(
          'p',
          `内容：${parsed.counts.contracts} 份合同、${parsed.counts.payments} 条收款、${parsed.counts.personnel} 名人员、${parsed.counts.dicts} 个字典项`,
        ),
        h('p', { style: 'color: #d9534f' }, '覆盖导入：用备份整体替换现有数据（不可撤销）'),
        h('p', { style: 'color: #2f9e63' }, '合并导入：按 id 去重，冲突取 updatedAt 较新者'),
        h('p', { style: 'color: #6b7280' }, '无论选择哪种方式，都会先自动下载当前数据快照留底。'),
      ]),
      showCancelButton: true,
      confirmButtonText: '覆盖导入',
      cancelButtonText: '合并导入',
      distinguishCancelAndClose: true,
      type: 'warning',
    })
    mode = 'overwrite'
  } catch (action) {
    if (action === 'cancel') mode = 'merge'
    else {
      ElMessage.info('已取消导入，现有数据未修改')
      return
    }
  }

  // 导入前自动快照留底
  try {
    const snapshot = await ledger.actions.exportSnapshot()
    ElMessage.success(`已下载导入前快照：${snapshot.fileName}`)
  } catch (error) {
    ElMessage.error(`快照下载失败，已中止导入：${error && error.message ? error.message : String(error)}`)
    return
  }

  const result = await ledger.actions.importBackup(parsed.payload, mode)
  if (result.ok) {
    ElMessage.success(result.message)
  } else {
    ElMessage.error(result.message || '导入失败，现有数据未被修改')
  }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm(
      '将清空全部合同、收款流水与人员档案，并把字典重置为内置项（保留设置）。此操作不可撤销，请先导出备份！',
      '清空全部数据',
      { confirmButtonText: '我已备份，确认清空', cancelButtonText: '取消', type: 'error' },
    )
  } catch {
    return
  }
  const result = await ledger.actions.clearAllData()
  if (result.ok) ElMessage.success('已清空业务数据，字典已重置为内置项')
  else ElMessage.error(result.message || '清空失败')
}

async function loadDemo() {
  try {
    await ElMessageBox.confirm(
      '将用 15 条演示数据替换当前全部业务数据（字典与设置会同步重置为演示配置，AI 配置保留）。建议先导出备份。',
      '恢复演示数据',
      { confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  const result = await ledger.actions.loadDemoData()
  if (result.ok) {
    ElMessage.success(
      `已恢复演示数据：${result.counts.contracts} 份合同 / ${result.counts.payments} 条收款 / ${result.counts.personnel} 名人员`,
    )
  } else {
    ElMessage.error(result.message || '恢复演示数据失败')
  }
}
</script>

<style scoped>
.import-error-list {
  margin: 12px 0 0;
  padding-left: 18px;
  max-height: 320px;
  overflow-y: auto;
  color: var(--el-color-danger);
  font-size: 13px;
  line-height: 1.8;
}
</style>
