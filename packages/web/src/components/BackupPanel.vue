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

    <el-alert type="info" :closable="false" show-icon title="导出 JSON 才是真正的异地存档">
      数据保存在本机 SQLite（data/ledger.db）：换机器、删数据目录都会丢失数据。
      备份包含合同、资金流水、交付明细、人员、字典与业务设置，并强制剔除 API Key / Base URL 等密钥字段。
    </el-alert>

    <div class="section-actions" style="margin-top: 14px">
      <el-button type="primary" @click="exportVisible = true">
        <el-icon><Download /></el-icon>
        导出备份
      </el-button>
      <el-button :loading="snapshotting" @click="downloadSnapshotOnly">
        <el-icon><DocumentCopy /></el-icon>
        下载当前快照
      </el-button>
      <el-tooltip
        content="清空全部数据 / 恢复演示数据入口已随浏览器存储一并移除：如需重置请在服务端重建数据库"
        placement="top"
      >
        <span>
          <el-button type="danger" plain disabled>
            <el-icon><Delete /></el-icon>
            清空全部数据
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
          导入流程：读取文件 → 选择覆盖或合并 → 自动下载当前数据快照 → 服务端单事务写入（失败整体回滚，现有数据不受影响）。
        </div>
      </template>
    </el-upload>

    <p class="form-tip">
      覆盖导入（replace）会用备份整体替换现有数据；合并导入（merge）按 id 去重。
      校验与写入都由本地服务在单事务内完成；导入前会自动下载一份当前数据快照留底。
    </p>

    <!-- 导出确认 -->
    <el-dialog v-model="exportVisible" title="导出备份" width="560px" append-to-body>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="合同">{{ counts.contracts }} 份</el-descriptions-item>
        <el-descriptions-item label="资金流水">{{ counts.payments }} 条</el-descriptions-item>
        <el-descriptions-item label="交付明细">{{ counts.deliveries }} 条</el-descriptions-item>
        <el-descriptions-item label="人员">{{ counts.personnel }} 名</el-descriptions-item>
        <el-descriptions-item label="字典项">{{ counts.dicts }} 项</el-descriptions-item>
        <el-descriptions-item label="设置">1 组（AI 密钥已剔除）</el-descriptions-item>
      </el-descriptions>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="导出内容说明"
        style="margin-top: 12px"
      >
        文件名形如「合同台账备份_YYYYMMDD_HHmm.json」。数据来自服务端 GET /api/export；
        API Key 与 Base URL 已在服务端剔除，不会写入备份文件。
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
  UploadFilled,
} from '@element-plus/icons-vue'
import { useLedger } from '../composables/useLedger'
import { formatDateTime } from '../utils/format'

const ledger = useLedger()
const meta = ledger.meta
const counts = computed(() => ({
  contracts: ledger.data.contracts.length,
  payments: ledger.data.payments.length,
  deliveries: ledger.data.deliveries.length,
  personnel: ledger.data.personnel.length,
  dicts: ledger.data.dicts.length,
}))
const writable = computed(() => ledger.storageInfo.value.writable)

const uploadRef = ref(null)
const exportVisible = ref(false)
const exporting = ref(false)
const snapshotting = ref(false)
const errorVisible = ref(false)
const importErrors = ref([])

async function confirmExport() {
  exporting.value = true
  try {
    const result = await ledger.actions.exportBackup()
    if (result.ok) {
      exportVisible.value = false
      ElMessage.success(`已导出 ${result.fileName}`)
    } else {
      ElMessage.error(result.message || '导出失败')
    }
  } finally {
    exporting.value = false
  }
}

async function downloadSnapshotOnly() {
  snapshotting.value = true
  try {
    const result = await ledger.actions.exportSnapshot()
    ElMessage.success(`已下载当前数据快照：${result.fileName}`)
  } catch (error) {
    ElMessage.error(`快照下载失败：${error && error.message ? error.message : String(error)}`)
  } finally {
    snapshotting.value = false
  }
}

function resetUpload() {
  if (uploadRef.value && typeof uploadRef.value.clearFiles === 'function') {
    uploadRef.value.clearFiles()
  }
}

/**
 * 读取文本文件。
 * @param {File} file
 * @returns {Promise<{ok:boolean, text?:string, message?:string}>}
 */
function readFileText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ ok: true, text: String(reader.result || '') })
    reader.onerror = () => resolve({ ok: false, message: '文件读取失败' })
    reader.readAsText(file)
  })
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
        h('p', { style: 'color: #d9534f' }, '覆盖导入（replace）：用备份整体替换现有数据（不可撤销）'),
        h('p', { style: 'color: #2f9e63' }, '合并导入（merge）：按 id 去重，冲突取较新数据'),
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

  // 第二次确认：导入会修改服务端数据
  try {
    await ElMessageBox.confirm(
      mode === 'overwrite'
        ? `确认以「${raw.name}」覆盖导入？现有全部业务数据将被替换，此操作不可撤销。`
        : `确认以「${raw.name}」合并导入？同 id 数据将被更新，此操作不可撤销。`,
      '确认导入',
      { confirmButtonText: '确认导入', cancelButtonText: '取消', type: 'error' },
    )
  } catch {
    ElMessage.info('已取消导入，现有数据未修改')
    return
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
    ElMessage.success(result.message || '导入完成')
  } else {
    importErrors.value = [result.message || '导入失败，现有数据未被修改']
    if (result.hint) importErrors.value.push(result.hint)
    errorVisible.value = true
    ElMessage.error(result.message || '导入失败，现有数据未被修改')
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
