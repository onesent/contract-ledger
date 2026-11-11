<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    :width="dialogWidth"
    top="6vh"
    append-to-body
    :close-on-click-modal="false"
    :before-close="beforeClose"
    destroy-on-close
  >
    <div class="toolbar" style="margin-bottom: 12px">
      <el-tooltip :disabled="aiReady" content="请在设置中配置 AI 后使用" placement="top">
        <span>
          <el-button :disabled="!aiReady" @click="aiVisible = true">
            <el-icon><MagicStick /></el-icon>
            粘贴文本智能填入
          </el-button>
        </span>
      </el-tooltip>
      <div class="toolbar-spacer" />
      <span class="small muted">未收金额与收款进度为派生字段（只读），随金额实时计算</span>
    </div>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      :label-width="labelWidth"
      :label-position="labelPosition"
      status-icon
    >
      <el-row :gutter="16">
        <el-col :xs="24" :sm="12">
          <el-form-item label="合同编号" prop="no">
            <el-input v-model="form.no" maxlength="40" clearable placeholder="例如 HT-202501-001">
              <template #append>
                <el-tooltip content="按设置中的编号规则生成（可手工覆盖）" placement="top">
                  <el-button :icon="Refresh" aria-label="生成合同编号" @click="fillNo" />
                </el-tooltip>
              </template>
            </el-input>
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="客户名称" prop="customer">
            <el-autocomplete
              v-model="form.customer"
              :fetch-suggestions="queryCustomers"
              placeholder="输入客户名称，可联想历史客户"
              clearable
              maxlength="80"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>

        <el-col :xs="24" :sm="12">
          <el-form-item label="合同类型" prop="typeCode">
            <el-select v-model="form.typeCode" placeholder="请选择合同类型" filterable style="width: 100%">
              <el-option
                v-for="item in typeOptions"
                :key="item.code"
                :label="item.name"
                :value="item.code"
              >
                <span class="dict-color-preview">
                  <span class="storage-dot" :style="{ background: item.color }" />
                  {{ item.name }}
                </span>
              </el-option>
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="合同状态" prop="statusCode">
            <el-select v-model="form.statusCode" placeholder="请选择状态" style="width: 100%">
              <el-option
                v-for="item in statusOptions"
                :key="item.code"
                :label="item.name"
                :value="item.code"
              >
                <span class="dict-color-preview">
                  <span class="storage-dot" :style="{ background: item.color }" />
                  {{ item.name }}
                  <span v-if="item.enabled === false" class="small muted">（已停用）</span>
                </span>
              </el-option>
            </el-select>
          </el-form-item>
        </el-col>

        <el-col :xs="24" :sm="12">
          <el-form-item label="合同金额" prop="amount">
            <el-input-number
              v-model="form.amount"
              :min="0"
              :precision="precision"
              :step="1000"
              controls-position="right"
              placeholder="0.00"
              style="width: 100%"
            />
            <div class="derived-hint">单位：元；支持 0（用于赠送 / 框架类合同）</div>
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="已收金额" prop="receivedAmount">
            <el-input-number
              v-model="form.receivedAmount"
              :min="0"
              :max="Number(form.amount) || 0"
              :precision="precision"
              :step="1000"
              controls-position="right"
              placeholder="0.00"
              style="width: 100%"
            />
            <div class="derived-hint">也可在列表中使用「登记收款」自动累加</div>
          </el-form-item>
        </el-col>

        <el-col :xs="24" :sm="12">
          <el-form-item label="未收金额">
            <el-input :model-value="formatMoney(unpaid, precision)" disabled class="readonly-field" />
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="收款进度">
            <div class="progress-preview">
              <el-progress
                v-if="percent !== null"
                :percentage="percent"
                :stroke-width="12"
                :color="progressColor"
                :show-text="false"
              />
              <span class="small" :class="{ muted: percent === null }">
                {{ percent === null ? '—（合同金额为 0）' : formatPercent(percent, 1) }}
              </span>
            </div>
          </el-form-item>
        </el-col>

        <el-col :xs="24" :sm="12">
          <el-form-item label="收款日期">
            <el-date-picker
              v-model="form.paymentDate"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              placeholder="最近一次收款日期"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="签订日期" prop="signDate">
            <el-date-picker
              v-model="form.signDate"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              placeholder="请选择签订日期"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>

        <el-col :xs="24" :sm="12">
          <el-form-item label="开始日期" prop="startDate">
            <el-date-picker
              v-model="form.startDate"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              placeholder="默认等于签订日期"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="到期日" prop="dueDate">
            <el-date-picker
              v-model="form.dueDate"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              placeholder="不得早于开始日期"
              :disabled-date="disabledDueDate"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>

        <el-col :xs="24" :sm="12">
          <el-form-item label="负责人" prop="ownerId">
            <el-select v-model="form.ownerId" placeholder="仅列出在职人员" filterable style="width: 100%">
              <el-option
                v-for="item in ownerOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
                :disabled="item.disabled"
              >
                <span>{{ item.label }}</span>
                <span v-if="item.deptName" class="small muted" style="margin-left: 6px">
                  {{ item.deptName }}
                </span>
              </el-option>
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="状态变更时间">
            <el-input :model-value="formatDateTime(form.statusChangedAt, '—')" disabled class="readonly-field" />
          </el-form-item>
        </el-col>

        <el-col :span="24">
          <el-form-item label="备注" prop="note">
            <el-input
              v-model="form.note"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              placeholder="选填：补充说明、付款约定等"
            />
          </el-form-item>
        </el-col>

        <el-col :xs="24" :sm="12">
          <el-form-item label="创建时间">
            <el-input :model-value="formatDateTime(form.createdAt, '—')" disabled class="readonly-field" />
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="更新时间">
            <el-input :model-value="formatDateTime(form.updatedAt, '—')" disabled class="readonly-field" />
          </el-form-item>
        </el-col>

        <el-col :span="24">
          <el-form-item label="附件元信息">
            <div style="width: 100%">
              <el-upload
                ref="uploadRef"
                :auto-upload="false"
                :before-upload="() => false"
                :on-change="onFileChange"
                :show-file-list="false"
                drag
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
              >
                <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
                <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
                <template #tip>
                  <div class="el-upload__tip">
                    仅记录文件名 / 大小 / 备注，不上传、不写入真实路径（自动上传已关闭）。
                  </div>
                </template>
              </el-upload>

              <el-table
                v-if="form.attachments.length"
                :data="form.attachments"
                size="small"
                border
                style="margin-top: 10px"
              >
                <el-table-column prop="name" label="文件名" min-width="180" show-overflow-tooltip />
                <el-table-column label="大小" width="100">
                  <template #default="{ row }">{{ formatFileSize(row.size) }}</template>
                </el-table-column>
                <el-table-column label="备注" min-width="160">
                  <template #default="{ row }">
                    <el-input v-model="row.note" size="small" maxlength="80" placeholder="附件备注" />
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="76" align="center">
                  <template #default="{ $index }">
                    <el-button link type="danger" @click="removeAttachment($index)">移除</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <p v-else class="derived-hint">尚未添加附件元信息（可选）。</p>
            </div>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <template #footer>
      <div class="toolbar" style="justify-content: flex-end">
        <el-button @click="requestClose">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">
          {{ isEdit ? '保存修改' : '创建合同' }}
        </el-button>
      </div>
    </template>

    <!-- AI 文本提取（预留入口，未配置时不可达） -->
    <el-dialog v-model="aiVisible" title="粘贴文本智能填入" width="560px" append-to-body>
      <el-input
        v-model="aiText"
        type="textarea"
        :rows="8"
        maxlength="4000"
        show-word-limit
        placeholder="把合同正文或关键条款粘贴到这里……"
      />
      <p class="ai-hint">
        当前为 AI 占位实现：不会发起任何网络请求，返回空字段时会如实提示。配置真实模型后可在
        src/ai/provider.js 中替换 complete() 实现。
      </p>
      <template #footer>
        <el-button @click="aiVisible = false">取消</el-button>
        <el-button type="primary" :loading="aiLoading" @click="runAi">智能填入</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { MagicStick, Refresh, UploadFilled } from '@element-plus/icons-vue'
import { useLedger } from '../composables/useLedger'
import { registerUnsavedGuard } from '../router'
import { contractRules } from '../utils/validate'
import {
  formatDateTime,
  formatFileSize,
  formatMoney,
  formatPercent,
  toNumber,
} from '../utils/format'
import { extractContract } from '../ai/provider'
import { nowIso, uuid } from '../utils/id'
import { useMediaQuery } from '../composables/useMediaQuery'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  contract: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const ledger = useLedger()
const isNarrow = useMediaQuery('(max-width: 1023px)')
const precision = ledger.precision

const formRef = ref(null)
const uploadRef = ref(null)
const saving = ref(false)
const aiVisible = ref(false)
const aiText = ref('')
const aiLoading = ref(false)
const loadedKey = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const isEdit = computed(() => Boolean(props.contract && props.contract.id))
const dialogTitle = computed(() => (isEdit.value ? `编辑合同 · ${props.contract.no}` : '新增合同'))
const dialogWidth = computed(() => (isNarrow.value ? '96%' : '900px'))
const labelWidth = computed(() => (isNarrow.value ? '100px' : '110px'))
const labelPosition = computed(() => (isNarrow.value ? 'top' : 'right'))

function blankContract() {
  const today = dayjs().format('YYYY-MM-DD')
  return {
    id: '',
    no: '',
    customer: '',
    typeCode: '',
    amount: 0,
    receivedAmount: 0,
    paymentDate: '',
    signDate: today,
    startDate: today,
    dueDate: '',
    statusCode: 'draft',
    ownerId: '',
    statusChangedAt: null,
    note: '',
    attachments: [],
    statusLogs: [],
    createdAt: '',
    updatedAt: '',
  }
}

const form = reactive(blankContract())

const rules = computed(() =>
  contractRules({
    contracts: ledger.data.contracts,
    currentId: form.id,
    precision: precision.value,
    getValues: () => form,
  }),
)

const unpaid = computed(() => {
  const amount = toNumber(form.amount, 0)
  const received = toNumber(form.receivedAmount, 0)
  return Math.max(0, amount - received)
})

const percent = computed(() => {
  const amount = toNumber(form.amount, 0)
  if (amount <= 0) return null
  const value = (toNumber(form.receivedAmount, 0) / amount) * 100
  if (!Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100))
})

const progressColor = computed(() => {
  if (percent.value === null) return '#c0c4cc'
  if (percent.value >= 100) return '#2f9e63'
  if (percent.value >= 60) return '#409eff'
  return '#d9932f'
})

const typeOptions = computed(() => {
  const list = ledger.dictsByCategory.value.contractType || []
  return list.filter((item) => item.enabled !== false || item.code === form.typeCode)
})

const statusOptions = computed(() => {
  const list = ledger.dictsByCategory.value.contractStatus || []
  return list.filter((item) => item.enabled !== false || item.code === form.statusCode)
})

const ownerOptions = computed(() => {
  const options = ledger.personnelOptions.value.map((item) => ({
    value: item.value,
    label: item.label,
    deptName: item.deptName,
    disabled: false,
  }))
  const current = ledger.personnelLookup.value.get(form.ownerId)
  if (current && current.active === false && !options.some((item) => item.value === current.id)) {
    options.push({
      value: current.id,
      label: `${current.name}（已离职，历史保留）`,
      deptName: '',
      disabled: true,
    })
  }
  return options
})

const aiReady = computed(() => ledger.aiReady.value)

const isDirty = computed(() => {
  if (!props.modelValue) return false
  return JSON.stringify(serialize()) !== loadedKey.value
})

function serialize() {
  return {
    ...form,
    attachments: form.attachments.map((item) => ({
      id: item.id,
      name: item.name,
      size: item.size,
      note: item.note,
    })),
  }
}

function load() {
  const source = props.contract || {}
  Object.assign(form, blankContract(), source)
  form.amount = toNumber(source.amount, 0)
  form.receivedAmount = toNumber(source.receivedAmount, 0)
  form.note = source.note || ''
  form.attachments = Array.isArray(source.attachments)
    ? source.attachments.map((item) => ({ ...item, note: item.note || '' }))
    : []
  form.statusLogs = Array.isArray(source.statusLogs) ? source.statusLogs : []
  if (!form.statusCode) {
    const enabledStatuses = (ledger.dictsByCategory.value.contractStatus || []).filter(
      (item) => item.enabled !== false,
    )
    form.statusCode = enabledStatuses.some((item) => item.code === 'draft')
      ? 'draft'
      : enabledStatuses[0]?.code || ''
  }
  if (!form.id && !form.no) form.no = ledger.actions.generateContractNo()
  if (!form.startDate) form.startDate = form.signDate || ''
  aiText.value = ''
  fileListReset()
  loadedKey.value = JSON.stringify(serialize())
  nextTick(() => {
    if (formRef.value) formRef.value.clearValidate()
  })
}

function fileListReset() {
  if (uploadRef.value && typeof uploadRef.value.clearFiles === 'function') {
    uploadRef.value.clearFiles()
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load()
  },
)

watch(
  () => props.contract,
  () => {
    if (props.modelValue) load()
  },
)

const FIELD_LABELS = {
  no: '合同编号',
  customer: '客户名称',
  typeCode: '合同类型',
  amount: '合同金额',
  receivedAmount: '已收金额',
  signDate: '签订日期',
  startDate: '开始日期',
  dueDate: '到期日',
  statusCode: '合同状态',
  ownerId: '负责人',
  note: '备注',
}

async function submit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch (fields) {
    const first = fields && typeof fields === 'object' ? Object.keys(fields)[0] : ''
    if (first && formRef.value) formRef.value.scrollToField(first)
    ElMessage.warning(
      first ? `表单校验未通过：请检查「${FIELD_LABELS[first] || first}」` : '表单校验未通过，请检查必填项',
    )
    return
  }
  saving.value = true
  try {
    const payload = {
      ...form,
      attachments: form.attachments.map((item) => ({ ...item })),
    }
    const result = await ledger.actions.saveContract(payload)
    if (!result.ok) {
      ElMessage.error(result.message || '保存失败')
      return
    }
    ElMessage.success(result.created ? '合同已创建' : '合同已保存')
    emit('saved', result)
    visible.value = false
  } finally {
    saving.value = false
  }
}

async function confirmClose(done) {
  if (!isDirty.value) {
    done()
    return
  }
  try {
    await ElMessageBox.confirm('当前表单有未保存的修改，关闭后将丢失这些修改。', '未保存修改', {
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
    done()
  } catch {
    /* 留在表单 */
  }
}

function beforeClose(done) {
  confirmClose(done)
}

function requestClose() {
  confirmClose(() => {
    visible.value = false
  })
}

function fillNo() {
  const no = ledger.actions.generateContractNo()
  form.no = no
  if (no) ElMessage.success(`已生成合同编号：${no}`)
  else ElMessage.info('合同编号自动生成已关闭，请手工填写')
}

function queryCustomers(queryString, callback) {
  const keyword = String(queryString || '').trim().toLowerCase()
  const list = ledger.customerSuggestions.value
    .filter((item) => !keyword || item.toLowerCase().includes(keyword))
    .slice(0, 10)
    .map((value) => ({ value }))
  callback(list)
}

function disabledDueDate(date) {
  const base = form.startDate || form.signDate
  if (!base) return false
  return dayjs(date).isBefore(dayjs(base), 'day')
}

function onFileChange(file) {
  if (!file || !file.raw) return
  if (form.attachments.length >= 10) {
    ElMessage.warning('最多记录 10 个附件元信息')
    fileListReset()
    return
  }
  form.attachments.push({
    id: uuid(),
    name: file.name,
    size: file.size,
    note: '',
    addedAt: nowIso(),
  })
  fileListReset()
  ElMessage.success('已记录附件元信息（不会上传文件）')
}

function removeAttachment(index) {
  form.attachments.splice(index, 1)
}

async function runAi() {
  if (!aiReady.value) return
  if (!aiText.value.trim()) {
    ElMessage.warning('请先粘贴合同文本')
    return
  }
  aiLoading.value = true
  try {
    const result = await extractContract(aiText.value, ledger.aiConfig.value)
    const fields = result && result.data ? result.data.fields : null
    if (result.ok && fields && Object.keys(fields).length) {
      Object.assign(form, fields)
      ElMessage.success('已填入 AI 提取的字段，请核对后保存')
      aiVisible.value = false
    } else {
      ElMessage.info(result.message || 'AI 未返回可用字段')
    }
  } catch (error) {
    ElMessage.error(`AI 调用失败：${error && error.message ? error.message : String(error)}`)
  } finally {
    aiLoading.value = false
  }
}

const unregisterGuard = registerUnsavedGuard(() =>
  props.modelValue && isDirty.value ? '合同表单还有未保存的修改，离开页面将丢失。' : '',
)
onBeforeUnmount(() => unregisterGuard())
</script>
