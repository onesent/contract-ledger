<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head-text">
        <h2 class="page-title">人员档案</h2>
        <p class="page-subtitle">
          合同负责人只能从在职人员中选择；人员改名不会改变历史合同的负责人姓名快照。
          删除或置为离职前，需先把名下合同批量转交给其他在职人员。
        </p>
      </div>
      <div class="page-actions">
        <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
          <span>
            <el-button type="primary" :disabled="!writable" @click="openCreate">
              <el-icon><Plus /></el-icon>
              新增人员
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="!isNarrow" label-position="top" class="filter-form" @submit.prevent>
        <el-form-item label="关键词">
          <el-input v-model="keyword" clearable placeholder="编号 / 姓名 / 岗位 / 手机" :prefix-icon="Search" />
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="deptFilter" clearable placeholder="全部部门">
            <el-option v-for="item in deptAllOptions" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="在职状态">
          <el-select v-model="activeFilter" placeholder="全部">
            <el-option label="全部" value="all" />
            <el-option label="在职" value="active" />
            <el-option label="离职" value="inactive" />
          </el-select>
        </el-form-item>
        <el-form-item label=" ">
          <el-button @click="resetFilters">
            <el-icon><Refresh /></el-icon>
            清除筛选
          </el-button>
        </el-form-item>
      </el-form>
      <div class="filter-summary">
        <span class="small muted">共 {{ filtered.length }} 人（全部 {{ ledger.data.personnel.length }} 人）</span>
      </div>
    </el-card>

    <el-card v-if="!isNarrow" shadow="never" class="table-card">
      <el-table :data="paged" v-loading="!ledger.status.ready" row-key="id" border stripe>
        <el-table-column prop="code" label="人员编号" width="120" />
        <el-table-column prop="name" label="姓名" width="110" />
        <el-table-column label="部门" width="110">
          <template #default="{ row }">{{ row.deptName }}</template>
        </el-table-column>
        <el-table-column prop="position" label="岗位" width="130" />
        <el-table-column prop="phone" label="手机" width="130" />
        <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
        <el-table-column label="在职状态" width="110" align="center">
          <template #default="{ row }">
            <el-tooltip :content="row.active ? '在职（可被指派为新合同负责人）' : '离职（不再出现在负责人下拉中）'" placement="top">
              <el-switch
                :model-value="row.active"
                :disabled="!writable"
                inline-prompt
                active-text="在职"
                inactive-text="离职"
                @change="(value) => toggleActive(row, value)"
              />
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="名下合同" width="100" align="center">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="row.contractCount === 0" @click="openContractsOf(row)">
              {{ row.contractCount }} 份
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="hireDate" label="入职日期" width="120">
          <template #default="{ row }">{{ formatDate(row.hireDate) }}</template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="160" show-overflow-tooltip />
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">
            <span class="muted">{{ formatDateTime(row.updatedAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <div class="cell-actions">
              <el-tooltip :disabled="writable" content="当前为只读模式" placement="top">
                <span><el-button link type="primary" :disabled="!writable" @click="openEdit(row)">编辑</el-button></span>
              </el-tooltip>
              <el-tooltip :disabled="writable" content="当前为只读模式" placement="top">
                <span><el-button link type="warning" :disabled="!writable" @click="openTransfer(row)">转交</el-button></span>
              </el-tooltip>
              <el-tooltip :disabled="writable" content="当前为只读模式" placement="top">
                <span><el-button link type="danger" :disabled="!writable" @click="removePersonnel(row)">删除</el-button></span>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无人员档案" :image-size="90">
            <el-button type="primary" :disabled="!writable" @click="openCreate">新增人员</el-button>
          </el-empty>
        </template>
      </el-table>
      <div v-if="filtered.length" class="pagination-bar">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="filtered.length"
          :page-sizes="[10, 20, 50]"
          background
          layout="total, sizes, prev, pager, next"
        />
      </div>
    </el-card>

    <div v-else class="mobile-card-list">
      <el-card v-for="row in paged" :key="row.id" class="mobile-card" shadow="never">
        <div class="mobile-card-head">
          <div class="mobile-card-title">{{ row.name }}（{{ row.code }}）</div>
          <el-tag :type="row.active ? 'success' : 'info'" effect="plain" size="small">
            {{ row.active ? '在职' : '离职' }}
          </el-tag>
          <div class="card-header-spacer" />
          <el-tag type="info" effect="plain" size="small">{{ row.contractCount }} 份合同</el-tag>
        </div>
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="部门">{{ row.deptName }}</el-descriptions-item>
          <el-descriptions-item label="岗位">{{ row.position || '—' }}</el-descriptions-item>
          <el-descriptions-item label="手机">{{ row.phone || '—' }}</el-descriptions-item>
          <el-descriptions-item label="邮箱">{{ row.email || '—' }}</el-descriptions-item>
          <el-descriptions-item label="入职日期">{{ formatDate(row.hireDate) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatDateTime(row.updatedAt) }}</el-descriptions-item>
        </el-descriptions>
        <div class="mobile-card-actions">
          <el-button size="small" type="primary" :disabled="!writable" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="warning" :disabled="!writable" @click="openTransfer(row)">转交合同</el-button>
          <el-button size="small" type="danger" plain :disabled="!writable" @click="removePersonnel(row)">删除</el-button>
        </div>
      </el-card>
      <el-empty v-if="!paged.length" description="暂无人员档案">
        <el-button type="primary" :disabled="!writable" @click="openCreate">新增人员</el-button>
      </el-empty>
      <div v-if="filtered.length" class="pagination-bar">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="filtered.length"
          :page-sizes="[10, 20, 50]"
          size="small"
          background
          layout="total, prev, pager, next"
        />
      </div>
    </div>

    <!-- 人员表单 -->
    <el-dialog
      v-model="formVisible"
      :title="form.id ? `编辑人员 · ${form.name}` : '新增人员'"
      :width="isNarrow ? '96%' : '640px'"
      append-to-body
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" :label-width="isNarrow ? '92px' : '100px'">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="12">
            <el-form-item label="人员编号" prop="code">
              <el-input v-model="form.code" maxlength="30" placeholder="例如 YG-001" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="姓名" prop="name">
              <el-input v-model="form.name" maxlength="30" placeholder="请输入姓名" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="部门" prop="deptCode">
              <el-select v-model="form.deptCode" placeholder="请选择部门" style="width: 100%">
                <el-option v-for="item in deptEnabledOptions" :key="item.code" :label="item.name" :value="item.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="岗位">
              <el-input v-model="form.position" maxlength="40" placeholder="例如 销售经理" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="手机" prop="phone">
              <el-input v-model="form.phone" maxlength="11" placeholder="11 位手机号" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="邮箱" prop="email">
              <el-input v-model="form.email" maxlength="80" placeholder="name@example.com" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="在职状态">
              <el-switch v-model="form.active" inline-prompt active-text="在职" inactive-text="离职" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="入职日期" prop="hireDate">
              <el-date-picker
                v-model="form.hireDate"
                type="date"
                value-format="YYYY-MM-DD"
                format="YYYY-MM-DD"
                placeholder="请选择入职日期"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.note" type="textarea" :rows="3" maxlength="300" show-word-limit placeholder="选填" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量转交 -->
    <el-dialog v-model="transferVisible" title="批量转交合同负责人" :width="isNarrow ? '96%' : '500px'" append-to-body>
      <el-alert type="info" :closable="false" show-icon :title="transferTitle" style="margin-bottom: 12px">
        {{ transferHint }}
      </el-alert>
      <el-form label-width="100px">
        <el-form-item label="转交给">
          <el-select v-model="transferToId" placeholder="选择在职人员" filterable style="width: 100%">
            <el-option
              v-for="item in transferTargets"
              :key="item.value"
              :label="`${item.label}（${item.deptName || '未分配部门'}）`"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="form-tip">
        转交会同步更新合同的负责人与负责人姓名快照，并写入一条操作日志；历史合同的收款与状态日志不受影响。
      </p>
      <template #footer>
        <el-button @click="transferVisible = false">取消</el-button>
        <el-button type="primary" :loading="transferSaving" :disabled="!transferToId" @click="confirmTransfer">
          确认转交
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { useLedger } from '../composables/useLedger'
import { useMediaQuery } from '../composables/useMediaQuery'
import { personnelRules } from '../utils/validate'
import { formatDate, formatDateTime } from '../utils/format'

const ledger = useLedger()
const router = useRouter()
const isNarrow = useMediaQuery('(max-width: 1023px)')
const writable = computed(() => ledger.storageInfo.value.writable)

const keyword = ref('')
const deptFilter = ref('')
const activeFilter = ref('all')
const currentPage = ref(1)
const pageSize = ref(10)

const deptAllOptions = computed(() => ledger.dictsByCategory.value.department || [])
const deptEnabledOptions = computed(() => ledger.dictOptions.value.department || [])

const personnelRows = computed(() =>
  ledger.data.personnel.map((person) => ({
    ...person,
    deptName: ledger.dictLookup.value.get(`department:${person.deptCode}`)?.name || '未分配部门',
    contractCount: ledger.data.contracts.filter((contract) => contract.ownerId === person.id).length,
  })),
)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return personnelRows.value.filter((row) => {
    if (deptFilter.value && row.deptCode !== deptFilter.value) return false
    if (activeFilter.value === 'active' && row.active !== true) return false
    if (activeFilter.value === 'inactive' && row.active !== false) return false
    if (kw) {
      const haystack = [row.code, row.name, row.position, row.phone, row.email, row.note]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(kw)) return false
    }
    return true
  })
})

const paged = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch([keyword, deptFilter, activeFilter, pageSize], () => {
  currentPage.value = 1
})

function resetFilters() {
  keyword.value = ''
  deptFilter.value = ''
  activeFilter.value = 'all'
}

function openContractsOf(row) {
  router.push({ path: '/contracts', query: { owner: row.id } })
}

// ---------- 表单 ----------
const formVisible = ref(false)
const saving = ref(false)
const formRef = ref(null)
const form = reactive({
  id: '',
  code: '',
  name: '',
  deptCode: '',
  position: '',
  phone: '',
  email: '',
  active: true,
  hireDate: '',
  note: '',
})

const rules = computed(() =>
  personnelRules({ personnel: ledger.data.personnel, currentId: form.id }),
)

function openCreate() {
  Object.assign(form, {
    id: '',
    code: '',
    name: '',
    deptCode: deptEnabledOptions.value[0]?.code || '',
    position: '',
    phone: '',
    email: '',
    active: true,
    hireDate: '',
    note: '',
  })
  formVisible.value = true
  nextTick(() => formRef.value?.clearValidate())
}

function openEdit(row) {
  Object.assign(form, {
    id: row.id,
    code: row.code,
    name: row.name,
    deptCode: row.deptCode,
    position: row.position,
    phone: row.phone,
    email: row.email,
    active: row.active !== false,
    hireDate: row.hireDate || '',
    note: row.note || '',
  })
  formVisible.value = true
  nextTick(() => formRef.value?.clearValidate())
}

async function submitForm() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    ElMessage.warning('请检查人员编号、姓名、部门与联系方式')
    return
  }
  saving.value = true
  try {
    const result = await ledger.actions.savePersonnel({ ...form })
    if (result.ok) {
      ElMessage.success(result.created ? '人员已创建' : '人员已保存')
      formVisible.value = false
    } else if (result.code === 'REFERENCED') {
      ElMessage.warning(result.message)
      transferFromId.value = form.id
      transferToId.value = ''
      transferVisible.value = true
    } else {
      ElMessage.error(result.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

// ---------- 状态切换 / 删除 ----------
async function toggleActive(row, value) {
  if (!writable.value) return
  const result = await ledger.actions.savePersonnel({ ...row, active: value })
  if (result.ok) {
    ElMessage.success(value ? `${row.name} 已置为在职` : `${row.name} 已置为离职`)
    return
  }
  if (result.code === 'REFERENCED') {
    ElMessage.warning(result.message)
    transferFromId.value = row.id
    transferToId.value = ''
    transferVisible.value = true
  } else {
    ElMessage.error(result.message || '操作失败')
  }
}

async function removePersonnel(row) {
  try {
    await ElMessageBox.confirm(`确认删除人员「${row.name}（${row.code}）」？此操作不可撤销。`, '删除人员', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const result = await ledger.actions.deletePersonnel(row.id)
  if (result.ok) {
    ElMessage.success('人员已删除')
    return
  }
  if (result.code === 'REFERENCED') {
    ElMessage.warning(result.message)
    transferFromId.value = row.id
    transferToId.value = ''
    transferVisible.value = true
  } else {
    ElMessage.error(result.message || '删除失败')
  }
}

// ---------- 转交 ----------
const transferVisible = ref(false)
const transferSaving = ref(false)
const transferFromId = ref('')
const transferToId = ref('')

const transferFrom = computed(() => ledger.personnelLookup.value.get(transferFromId.value) || null)
const transferCount = computed(() =>
  ledger.data.contracts.filter((contract) => contract.ownerId === transferFromId.value).length,
)
const transferTitle = computed(() =>
  transferFrom.value
    ? `${transferFrom.value.name} 名下有 ${transferCount.value} 份合同`
    : '选择需要转交的合同',
)
const transferHint = computed(() =>
  transferCount.value > 0
    ? '请选择一位在职人员接收这些合同；转交后该人员才能被删除或保持离职状态。'
    : '该人员名下没有合同，可直接删除或置为离职。',
)
const transferTargets = computed(() =>
  ledger.personnelOptions.value.filter((item) => item.value !== transferFromId.value),
)

function openTransfer(row) {
  transferFromId.value = row.id
  transferToId.value = ''
  transferVisible.value = true
}

async function confirmTransfer() {
  if (!transferToId.value) return
  transferSaving.value = true
  try {
    const result = await ledger.actions.transferContracts({
      fromId: transferFromId.value,
      toId: transferToId.value,
    })
    if (result.ok) {
      ElMessage.success(`已转交 ${result.count} 份合同，并写入操作日志`)
      transferVisible.value = false
      formVisible.value = false
    } else {
      ElMessage.error(result.message || '转交失败')
    }
  } finally {
    transferSaving.value = false
  }
}
</script>
