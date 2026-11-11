<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head-text">
        <h2 class="page-title">合同管理</h2>
        <p class="page-subtitle">
          17 个字段分为「录入 / 派生 / 系统自动」三类；未收金额与收款进度由金额实时计算，不可手改。
        </p>
      </div>
      <div class="page-actions">
        <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
          <span>
            <el-button type="primary" :disabled="!writable" @click="openCreate">
              <el-icon><Plus /></el-icon>
              新增合同
            </el-button>
          </span>
        </el-tooltip>
        <el-button @click="columnDrawer = true">
          <el-icon><Setting /></el-icon>
          列设置
        </el-button>
        <el-button @click="exportNow">
          <el-icon><Download /></el-icon>
          导出备份
        </el-button>
      </div>
    </div>

    <!-- 筛选区 -->
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" :inline="!isNarrow" label-position="top" class="filter-form" @submit.prevent>
        <el-form-item label="关键词">
          <el-input
            v-model="filters.keyword"
            clearable
            placeholder="编号 / 客户 / 负责人 / 备注"
            :prefix-icon="Search"
          />
        </el-form-item>
        <el-form-item label="快捷筛选">
          <el-select v-model="filters.quick" placeholder="全部合同">
            <el-option v-for="item in ledger.quickFilters" :key="item.value" :label="item.label" :value="item.value">
              <span>{{ item.label }}</span>
              <span class="small muted" style="margin-left: 6px">{{ item.description }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="合同类型">
          <el-select v-model="filters.typeCodes" multiple collapse-tags collapse-tags-tooltip clearable placeholder="全部类型">
            <el-option v-for="item in typeOptions" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="合同状态">
          <el-select v-model="filters.statusCodes" multiple collapse-tags collapse-tags-tooltip clearable placeholder="全部状态">
            <el-option v-for="item in statusOptions" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="filters.ownerIds" multiple collapse-tags collapse-tags-tooltip clearable placeholder="全部负责人">
            <el-option v-for="item in ownerFilterOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="签订日期">
          <el-date-picker
            v-model="signedRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            range-separator="至"
            unlink-panels
          />
        </el-form-item>
        <el-form-item label="到期区间">
          <el-date-picker
            v-model="dueRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            range-separator="至"
            unlink-panels
          />
        </el-form-item>
        <el-form-item label="金额区间（元）">
          <div class="toolbar">
            <el-input-number v-model="filters.amountMin" :min="0" :step="1000" :controls="false" placeholder="最小" class="is-range-input" />
            <span class="muted">—</span>
            <el-input-number v-model="filters.amountMax" :min="0" :step="1000" :controls="false" placeholder="最大" class="is-range-input" />
          </div>
        </el-form-item>
        <el-form-item label="收款进度（%）">
          <div class="toolbar">
            <el-input-number v-model="filters.progressMin" :min="0" :max="100" :step="10" :controls="false" placeholder="最小" class="is-range-input" />
            <span class="muted">—</span>
            <el-input-number v-model="filters.progressMax" :min="0" :max="100" :step="10" :controls="false" placeholder="最大" class="is-range-input" />
          </div>
        </el-form-item>
        <el-form-item label="有未收金额">
          <el-switch v-model="filters.hasUnpaid" inline-prompt active-text="仅未收" inactive-text="全部" />
        </el-form-item>
        <el-form-item label=" ">
          <el-button @click="resetFilters">
            <el-icon><Refresh /></el-icon>
            清除筛选
          </el-button>
        </el-form-item>
      </el-form>

      <div class="filter-summary">
        <span class="small muted">
          共 {{ filtered.length }} 条（全部 {{ ledger.data.contracts.length }} 条）
        </span>
        <el-tag
          v-for="tag in activeFilterTags"
          :key="tag.key"
          class="filter-tag"
          closable
          size="small"
          type="info"
          @close="clearFilterTag(tag.key)"
        >
          {{ tag.text }}
        </el-tag>
        <span v-if="!activeFilterTags.length" class="small muted">未设置筛选条件</span>
      </div>
    </el-card>

    <!-- 批量操作 -->
    <div v-if="selectedRows.length" class="selection-bar">
      <el-icon><Select /></el-icon>
      已选择 {{ selectedRows.length }} 份合同
      <div class="toolbar-spacer" />
      <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
        <span>
          <el-button size="small" :disabled="!writable" @click="openBulkStatus">批量改状态</el-button>
        </span>
      </el-tooltip>
      <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
        <span>
          <el-button size="small" :disabled="!writable" @click="openBulkOwner">批量改负责人</el-button>
        </span>
      </el-tooltip>
      <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
        <span>
          <el-button size="small" type="danger" plain :disabled="!writable" @click="bulkDelete">
            批量删除
          </el-button>
        </span>
      </el-tooltip>
      <el-button size="small" text @click="clearSelection">取消选择</el-button>
    </div>

    <!-- 桌面表格 -->
    <el-card v-if="!isNarrow" shadow="never" class="table-card">
      <ContractTable
        ref="tableRef"
        :contracts="paged"
        :loading="!ledger.status.ready"
        :visible="ledger.visibleColumns.value"
        :precision="precision"
        :default-sort="defaultSort"
        :writable="writable"
        @detail="openDetail"
        @edit="openEdit"
        @copy="openCopy"
        @delete="removeContract"
        @payment="openPayment"
        @create="openCreate"
        @selection-change="onSelectionChange"
        @sort-change="onSortChange"
      />
      <div v-if="filtered.length" class="pagination-bar">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="filtered.length"
          :page-sizes="[10, 20, 50, 100]"
          background
          layout="total, sizes, prev, pager, next, jumper"
        />
      </div>
    </el-card>

    <!-- 窄屏卡片布局 -->
    <div v-else class="mobile-card-list">
      <el-card v-for="row in paged" :key="row.id" class="mobile-card" shadow="never">
        <div class="mobile-card-head">
          <div class="mobile-card-title">{{ row.no }}</div>
          <el-tag effect="plain" size="small" :style="tagStyle(row.statusColor)">{{ row.statusName }}</el-tag>
          <el-tag v-if="row.overdue" type="danger" effect="plain" size="small">逾期 {{ row.overdueDays }} 天</el-tag>
          <el-tag v-else-if="row.dueSoon" type="warning" effect="plain" size="small">临期</el-tag>
          <div class="card-header-spacer" />
          <span class="money-cell" :class="{ 'is-unpaid': row.unpaid > 0 }">
            {{ formatMoney(row.unpaid, precision) }}
          </span>
        </div>
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="客户">{{ row.customer }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ row.typeName }}</el-descriptions-item>
          <el-descriptions-item label="合同金额">{{ formatMoney(row.amount, precision) }}</el-descriptions-item>
          <el-descriptions-item label="已收金额">{{ formatMoney(row.receivedAmount, precision) }}</el-descriptions-item>
          <el-descriptions-item label="收款进度">
            {{ row.percent === null ? '—' : formatPercent(row.percent, 1) }}
          </el-descriptions-item>
          <el-descriptions-item label="到期日">{{ formatDate(row.dueDate) }}</el-descriptions-item>
          <el-descriptions-item label="负责人">{{ row.ownerName }}</el-descriptions-item>
          <el-descriptions-item label="收款日期">{{ formatDate(row.paymentDate) }}</el-descriptions-item>
        </el-descriptions>
        <div class="mobile-card-actions">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
            <span><el-button size="small" type="primary" :disabled="!writable" @click="openEdit(row)">编辑</el-button></span>
          </el-tooltip>
          <el-button size="small" type="success" :disabled="!writable || row.unpaid <= 0" @click="openPayment(row)">收款</el-button>
          <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
            <span><el-button size="small" type="danger" plain :disabled="!writable" @click="removeContract(row)">删除</el-button></span>
          </el-tooltip>
        </div>
      </el-card>
      <el-empty v-if="!paged.length" description="暂无符合条件的合同">
        <el-button type="primary" :disabled="!writable" @click="openCreate">新增合同</el-button>
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

    <!-- 列显隐设置 -->
    <el-drawer v-model="columnDrawer" title="列显隐设置" size="360px" append-to-body>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="设置会自动记忆到浏览器存储的设置项中"
        style="margin-bottom: 12px"
      />
      <el-checkbox-group v-model="visibleProps" class="column-checkbox-group" @change="persistVisibility">
        <el-checkbox v-for="column in ledger.columns" :key="column.prop" :value="column.prop">
          {{ column.label }}
        </el-checkbox>
      </el-checkbox-group>
      <div class="section-actions">
        <el-button size="small" @click="selectAllColumns">全选</el-button>
        <el-button size="small" @click="resetColumns">恢复默认</el-button>
      </div>
    </el-drawer>

    <!-- 合同表单 -->
    <ContractForm v-model="formVisible" :contract="editingContract" @saved="onSaved" />

    <!-- 合同详情 -->
    <ContractDetail
      v-model="detailVisible"
      :contract="detailContract"
      @edit="openEdit"
      @payment="openPayment"
    />

    <!-- 登记收款 -->
    <el-dialog v-model="paymentVisible" title="登记收款" width="480px" append-to-body destroy-on-close>
      <el-alert
        v-if="paymentContract"
        type="info"
        :closable="false"
        :title="`${paymentContract.no} · ${paymentContract.customer}`"
        style="margin-bottom: 12px"
      >
        合同金额 {{ formatMoney(paymentContract.amount, precision) }}，已收
        {{ formatMoney(paymentContract.receivedAmount, precision) }}，剩余
        <b>{{ formatMoney(paymentRemaining, precision) }}</b>
      </el-alert>
      <el-form ref="paymentFormRef" :model="paymentForm" :rules="paymentFormRules" label-width="92px">
        <el-form-item label="收款金额" prop="amount">
          <el-input-number
            v-model="paymentForm.amount"
            :min="0.01"
            :max="paymentRemaining"
            :precision="precision"
            :step="1000"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="收款日期" prop="date">
          <el-date-picker
            v-model="paymentForm.date"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            placeholder="请选择收款日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="付款方式" prop="methodCode">
          <el-select v-model="paymentForm.methodCode" placeholder="请选择付款方式" style="width: 100%">
            <el-option v-for="item in payMethodOptions" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注" prop="note">
          <el-input v-model="paymentForm.note" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="paymentVisible = false">取消</el-button>
        <el-button type="primary" :loading="paymentSaving" @click="submitPayment">确认登记</el-button>
      </template>
    </el-dialog>

    <!-- 批量改状态 -->
    <el-dialog v-model="bulkStatusVisible" title="批量修改状态" width="420px" append-to-body>
      <p class="small muted">将修改 {{ selectedRows.length }} 份合同的状态，每份合同都会追加一条状态变更日志。</p>
      <el-select v-model="bulkStatus" placeholder="请选择新状态" style="width: 100%">
        <el-option v-for="item in statusOptions" :key="item.code" :label="item.name" :value="item.code" />
      </el-select>
      <template #footer>
        <el-button @click="bulkStatusVisible = false">取消</el-button>
        <el-button type="primary" :loading="bulkSaving" @click="applyBulkStatus">确认修改</el-button>
      </template>
    </el-dialog>

    <!-- 批量改负责人 -->
    <el-dialog v-model="bulkOwnerVisible" title="批量修改负责人" width="420px" append-to-body>
      <p class="small muted">将把 {{ selectedRows.length }} 份合同的负责人改为所选在职人员。</p>
      <el-select v-model="bulkOwnerId" placeholder="请选择负责人" filterable style="width: 100%">
        <el-option v-for="item in ledger.personnelOptions.value" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <template #footer>
        <el-button @click="bulkOwnerVisible = false">取消</el-button>
        <el-button type="primary" :loading="bulkSaving" @click="applyBulkOwner">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { Download, Plus, Refresh, Search, Select, Setting } from '@element-plus/icons-vue'
import ContractTable from '../components/ContractTable.vue'
import ContractForm from '../components/ContractForm.vue'
import ContractDetail from '../components/ContractDetail.vue'
import { useLedger } from '../composables/useLedger'
import { useMediaQuery } from '../composables/useMediaQuery'
import { paymentRules } from '../utils/validate'
import {
  formatDate,
  formatMoney,
  formatPercent,
  toNumber,
} from '../utils/format'

const ledger = useLedger()
const route = useRoute()
const router = useRouter()
const isNarrow = useMediaQuery('(max-width: 1023px)')
const precision = ledger.precision
const writable = computed(() => ledger.storageInfo.value.writable)

const tableRef = ref(null)
const formVisible = ref(false)
const editingContract = ref(null)
const detailVisible = ref(false)
const detailId = ref('')

const filters = reactive({
  keyword: '',
  quick: 'all',
  typeCodes: [],
  statusCodes: [],
  ownerIds: [],
  signedFrom: '',
  signedTo: '',
  dueFrom: '',
  dueTo: '',
  amountMin: null,
  amountMax: null,
  progressMin: null,
  progressMax: null,
  hasUnpaid: false,
})

const currentPage = ref(1)
const pageSize = ref(Number(ledger.settings.value.pageSize) || 20)
const sort = reactive({ prop: 'signDate', order: 'descending' })
const defaultSort = { prop: 'signDate', order: 'descending' }
const selectedRows = ref([])

const signedRange = computed({
  get: () => (filters.signedFrom && filters.signedTo ? [filters.signedFrom, filters.signedTo] : null),
  set: (value) => {
    filters.signedFrom = value && value[0] ? value[0] : ''
    filters.signedTo = value && value[1] ? value[1] : ''
  },
})
const dueRange = computed({
  get: () => (filters.dueFrom && filters.dueTo ? [filters.dueFrom, filters.dueTo] : null),
  set: (value) => {
    filters.dueFrom = value && value[0] ? value[0] : ''
    filters.dueTo = value && value[1] ? value[1] : ''
  },
})

const typeOptions = computed(() => ledger.dictsByCategory.value.contractType || [])
const statusOptions = computed(() => ledger.dictsByCategory.value.contractStatus || [])
const ownerFilterOptions = computed(() =>
  ledger.data.personnel.map((person) => ({ value: person.id, label: `${person.name}${person.active ? '' : '（离职）'}` })),
)
const payMethodOptions = computed(() => ledger.dictOptions.value.payMethod || [])

const filtered = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase()
  return ledger.contracts.value.filter((contract) => {
    if (filters.quick && filters.quick !== 'all') {
      if (!ledger.actions.matchesQuick(contract, filters.quick)) return false
    }
    if (keyword) {
      const haystack = [contract.no, contract.customer, contract.ownerName, contract.note, contract.typeName, contract.statusName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    if (filters.typeCodes.length && !filters.typeCodes.includes(contract.typeCode)) return false
    if (filters.statusCodes.length && !filters.statusCodes.includes(contract.statusCode)) return false
    if (filters.ownerIds.length && !filters.ownerIds.includes(contract.ownerId)) return false
    if (filters.signedFrom && (!contract.signDate || contract.signDate < filters.signedFrom)) return false
    if (filters.signedTo && (!contract.signDate || contract.signDate > filters.signedTo)) return false
    if (filters.dueFrom && (!contract.dueDate || contract.dueDate < filters.dueFrom)) return false
    if (filters.dueTo && (!contract.dueDate || contract.dueDate > filters.dueTo)) return false
    if (filters.amountMin !== null && filters.amountMin !== undefined && toNumber(contract.amount) < filters.amountMin) return false
    if (filters.amountMax !== null && filters.amountMax !== undefined && toNumber(contract.amount) > filters.amountMax) return false
    if (filters.progressMin !== null && filters.progressMin !== undefined) {
      if (contract.percent === null || contract.percent < filters.progressMin) return false
    }
    if (filters.progressMax !== null && filters.progressMax !== undefined) {
      if (contract.percent === null || contract.percent > filters.progressMax) return false
    }
    if (filters.hasUnpaid && contract.unpaid <= 0) return false
    return true
  })
})

const sorted = computed(() => {
  const list = filtered.value.slice()
  if (!sort.prop || !sort.order) return list
  const direction = sort.order === 'ascending' ? 1 : -1
  const valueOf = (row) => {
    switch (sort.prop) {
      case 'typeCode':
        return row.typeName
      case 'statusCode':
        return row.statusName
      case 'percent':
        return row.percent === null ? -1 : row.percent
      default:
        return row[sort.prop]
    }
  }
  list.sort((a, b) => {
    const av = valueOf(a)
    const bv = valueOf(b)
    if (av === bv) return 0
    const aEmpty = av === null || av === undefined || av === ''
    const bEmpty = bv === null || bv === undefined || bv === ''
    if (aEmpty && bEmpty) return 0
    if (aEmpty) return 1
    if (bEmpty) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction
    return String(av).localeCompare(String(bv), 'zh') * direction
  })
  return list
})

const paged = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return sorted.value.slice(start, start + pageSize.value)
})

const activeFilterTags = computed(() => {
  const tags = []
  if (filters.quick && filters.quick !== 'all') {
    const quick = ledger.quickFilters.find((item) => item.value === filters.quick)
    tags.push({ key: 'quick', text: `快捷：${quick ? quick.label : filters.quick}` })
  }
  if (filters.keyword) tags.push({ key: 'keyword', text: `关键词：${filters.keyword}` })
  if (filters.typeCodes.length) {
    const names = filters.typeCodes.map((code) => typeOptions.value.find((item) => item.code === code)?.name || code)
    tags.push({ key: 'type', text: `类型：${names.join('、')}` })
  }
  if (filters.statusCodes.length) {
    const names = filters.statusCodes.map((code) => statusOptions.value.find((item) => item.code === code)?.name || code)
    tags.push({ key: 'status', text: `状态：${names.join('、')}` })
  }
  if (filters.ownerIds.length) {
    const names = filters.ownerIds.map((id) => ownerFilterOptions.value.find((item) => item.value === id)?.label || id)
    tags.push({ key: 'owner', text: `负责人：${names.join('、')}` })
  }
  if (filters.signedFrom || filters.signedTo) {
    tags.push({ key: 'signed', text: `签订：${filters.signedFrom || '—'} ~ ${filters.signedTo || '—'}` })
  }
  if (filters.dueFrom || filters.dueTo) {
    tags.push({ key: 'due', text: `到期：${filters.dueFrom || '—'} ~ ${filters.dueTo || '—'}` })
  }
  const hasNumber = (value) => value !== null && value !== undefined && value !== ''
  if (hasNumber(filters.amountMin) || hasNumber(filters.amountMax)) {
    tags.push({
      key: 'amount',
      text: `金额：${hasNumber(filters.amountMin) ? formatMoney(filters.amountMin, 0) : '不限'} ~ ${
        hasNumber(filters.amountMax) ? formatMoney(filters.amountMax, 0) : '不限'
      }`,
    })
  }
  if (hasNumber(filters.progressMin) || hasNumber(filters.progressMax)) {
    tags.push({
      key: 'progress',
      text: `进度：${hasNumber(filters.progressMin) ? filters.progressMin : 0}% ~ ${
        hasNumber(filters.progressMax) ? filters.progressMax : 100
      }%`,
    })
  }
  if (filters.hasUnpaid) tags.push({ key: 'unpaid', text: '仅有未收金额' })
  return tags
})

const detailContract = computed(() => ledger.contracts.value.find((item) => item.id === detailId.value) || null)

watch(
  () => ledger.settings.value.pageSize,
  (value) => {
    pageSize.value = Number(value) || 20
    currentPage.value = 1
  },
)

watch(
  () => [filters.keyword, filters.quick, filters.typeCodes.length, filters.statusCodes.length, filters.ownerIds.length, filters.signedFrom, filters.signedTo, filters.dueFrom, filters.dueTo, filters.amountMin, filters.amountMax, filters.progressMin, filters.progressMax, filters.hasUnpaid],
  () => {
    currentPage.value = 1
  },
)

watch(
  () => [sort.prop, sort.order],
  () => {
    currentPage.value = 1
  },
)

function toArray(value) {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return value.map(String)
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function resetFilters() {
  filters.keyword = ''
  filters.quick = 'all'
  filters.typeCodes = []
  filters.statusCodes = []
  filters.ownerIds = []
  filters.signedFrom = ''
  filters.signedTo = ''
  filters.dueFrom = ''
  filters.dueTo = ''
  filters.amountMin = null
  filters.amountMax = null
  filters.progressMin = null
  filters.progressMax = null
  filters.hasUnpaid = false
  currentPage.value = 1
}

function clearFilterTag(key) {
  switch (key) {
    case 'quick':
      filters.quick = 'all'
      break
    case 'keyword':
      filters.keyword = ''
      break
    case 'type':
      filters.typeCodes = []
      break
    case 'status':
      filters.statusCodes = []
      break
    case 'owner':
      filters.ownerIds = []
      break
    case 'signed':
      filters.signedFrom = ''
      filters.signedTo = ''
      break
    case 'due':
      filters.dueFrom = ''
      filters.dueTo = ''
      break
    case 'amount':
      filters.amountMin = null
      filters.amountMax = null
      break
    case 'progress':
      filters.progressMin = null
      filters.progressMax = null
      break
    case 'unpaid':
      filters.hasUnpaid = false
      break
    default:
      break
  }
}

function applyRouteQuery() {
  const query = route.query || {}
  resetFilters()
  filters.quick = typeof query.quick === 'string' && query.quick ? query.quick : 'all'
  filters.keyword = typeof query.keyword === 'string' ? query.keyword : ''
  filters.typeCodes = toArray(query.type)
  filters.statusCodes = toArray(query.status)
  filters.ownerIds = toArray(query.owner)
  filters.signedFrom = typeof query.signedFrom === 'string' ? query.signedFrom : ''
  filters.signedTo = typeof query.signedTo === 'string' ? query.signedTo : ''
  filters.dueFrom = typeof query.dueFrom === 'string' ? query.dueFrom : ''
  filters.dueTo = typeof query.dueTo === 'string' ? query.dueTo : ''
  filters.amountMin = query.amountMin !== undefined && query.amountMin !== '' ? Number(query.amountMin) : null
  filters.amountMax = query.amountMax !== undefined && query.amountMax !== '' ? Number(query.amountMax) : null
  filters.progressMin = query.progressMin !== undefined && query.progressMin !== '' ? Number(query.progressMin) : null
  filters.progressMax = query.progressMax !== undefined && query.progressMax !== '' ? Number(query.progressMax) : null
  filters.hasUnpaid = query.unpaid === '1'

  const action = typeof query.action === 'string' ? query.action : ''
  const detail = typeof query.detail === 'string' ? query.detail : ''
  if (action === 'create') openCreate()
  if (detail) openDetailById(detail)
  if (action || detail) {
    const nextQuery = { ...query }
    delete nextQuery.action
    delete nextQuery.detail
    router.replace({ path: '/contracts', query: nextQuery })
  }
}

function onSelectionChange(rows) {
  selectedRows.value = rows
}

function onSortChange({ prop, order }) {
  sort.prop = prop || ''
  sort.order = order || ''
}

function clearSelection() {
  selectedRows.value = []
  if (tableRef.value && typeof tableRef.value.clearSelection === 'function') {
    tableRef.value.clearSelection()
  }
}

function openCreate() {
  if (!writable.value) {
    ElMessage.warning('当前为只读模式，无法新增合同')
    return
  }
  editingContract.value = null
  formVisible.value = true
}

function openEdit(row) {
  if (!writable.value) {
    ElMessage.warning('当前为只读模式，无法编辑合同')
    return
  }
  editingContract.value = row
  formVisible.value = true
}

function openCopy(row) {
  if (!writable.value) {
    ElMessage.warning('当前为只读模式，无法复制合同')
    return
  }
  editingContract.value = ledger.actions.copyContract(row)
  formVisible.value = true
}

function openDetail(row) {
  detailId.value = row.id
  detailVisible.value = true
}

function openDetailById(id) {
  const row = ledger.contracts.value.find((item) => item.id === id)
  if (row) openDetail(row)
}

function onSaved(result) {
  if (result && result.contract) {
    editingContract.value = null
  }
}

async function removeContract(row) {
  if (!writable.value) {
    ElMessage.warning('当前为只读模式，无法删除合同')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除合同「${row.no} · ${row.customer}」？关联的收款流水会一并删除，此操作不可撤销。`,
      '删除合同',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  const result = await ledger.actions.deleteContracts([row.id])
  if (result.ok) {
    ElMessage.success(`已删除 ${row.no}`)
    if (detailId.value === row.id) detailVisible.value = false
  } else {
    ElMessage.error(result.message || '删除失败')
  }
}

// ---------- 批量操作 ----------
const bulkStatusVisible = ref(false)
const bulkOwnerVisible = ref(false)
const bulkStatus = ref('')
const bulkOwnerId = ref('')
const bulkSaving = ref(false)

const selectedIds = computed(() => selectedRows.value.map((row) => row.id))

function openBulkStatus() {
  bulkStatus.value = ''
  bulkStatusVisible.value = true
}

function openBulkOwner() {
  bulkOwnerId.value = ''
  bulkOwnerVisible.value = true
}

async function applyBulkStatus() {
  if (!bulkStatus.value) {
    ElMessage.warning('请选择新状态')
    return
  }
  bulkSaving.value = true
  try {
    const result = await ledger.actions.bulkUpdate(selectedIds.value, { statusCode: bulkStatus.value })
    if (result.ok) {
      ElMessage.success(`已更新 ${result.count} 份合同，其中 ${result.statusChanges} 份追加了状态变更日志`)
      bulkStatusVisible.value = false
      clearSelection()
    } else {
      ElMessage.error(result.message || '批量修改失败')
    }
  } finally {
    bulkSaving.value = false
  }
}

async function applyBulkOwner() {
  if (!bulkOwnerId.value) {
    ElMessage.warning('请选择负责人')
    return
  }
  bulkSaving.value = true
  try {
    const result = await ledger.actions.bulkUpdate(selectedIds.value, { ownerId: bulkOwnerId.value })
    if (result.ok) {
      ElMessage.success(`已更新 ${result.count} 份合同的负责人`)
      bulkOwnerVisible.value = false
      clearSelection()
    } else {
      ElMessage.error(result.message || '批量修改失败')
    }
  } finally {
    bulkSaving.value = false
  }
}

async function bulkDelete() {
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedIds.value.length} 份合同？关联的收款流水会一并删除，此操作不可撤销。`,
      '批量删除',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  const result = await ledger.actions.deleteContracts(selectedIds.value)
  if (result.ok) {
    ElMessage.success(`已删除 ${result.contracts} 份合同、${result.payments} 条收款流水`)
    clearSelection()
    detailVisible.value = false
  } else {
    ElMessage.error(result.message || '批量删除失败')
  }
}

// ---------- 登记收款 ----------
const paymentVisible = ref(false)
const paymentSaving = ref(false)
const paymentFormRef = ref(null)
const paymentForm = reactive({
  contractId: '',
  amount: 0,
  date: dayjs().format('YYYY-MM-DD'),
  methodCode: '',
  note: '',
})

const paymentContract = computed(
  () => ledger.contracts.value.find((item) => item.id === paymentForm.contractId) || null,
)
const paymentRemaining = computed(() => {
  if (!paymentContract.value) return 0
  const remaining = toNumber(paymentContract.value.amount) - toNumber(paymentContract.value.receivedAmount)
  return Math.max(0, Math.round(remaining * 100) / 100)
})

const paymentFormRules = computed(() =>
  paymentRules({
    getMax: () => paymentRemaining.value,
    precision: precision.value,
  }),
)

function openPayment(row) {
  if (!writable.value) {
    ElMessage.warning('当前为只读模式，无法登记收款')
    return
  }
  paymentForm.contractId = row.id
  paymentForm.amount = paymentRemaining.value
  paymentForm.date = dayjs().format('YYYY-MM-DD')
  paymentForm.methodCode = payMethodOptions.value[0]?.code || ''
  paymentForm.note = ''
  paymentVisible.value = true
  nextTick(() => {
    if (paymentFormRef.value) paymentFormRef.value.clearValidate()
  })
}

async function submitPayment() {
  if (!paymentFormRef.value) return
  try {
    await paymentFormRef.value.validate()
  } catch {
    ElMessage.warning('请检查收款金额、日期与付款方式')
    return
  }
  paymentSaving.value = true
  try {
    const result = await ledger.actions.registerPayment({ ...paymentForm })
    if (result.ok) {
      ElMessage.success(`已登记收款 ${formatMoney(result.payment.amount, precision.value)}，合同已收金额已累加`)
      paymentVisible.value = false
    } else {
      ElMessage.error(result.message || '登记收款失败')
    }
  } finally {
    paymentSaving.value = false
  }
}

// ---------- 列显隐 ----------
const columnDrawer = ref(false)
const visibilityDraft = reactive({ ...ledger.settings.value.columnVisibility })
const visibleProps = computed({
  get: () =>
    ledger.columns.filter((column) => visibilityDraft[column.prop] !== false).map((column) => column.prop),
  set: (props) => {
    for (const column of ledger.columns) {
      visibilityDraft[column.prop] = props.includes(column.prop)
    }
  },
})

watch(
  () => ledger.settings.value.columnVisibility,
  (value) => {
    Object.assign(visibilityDraft, value)
  },
  { deep: true },
)

async function persistVisibility() {
  const result = await ledger.actions.saveColumnVisibility({ ...visibilityDraft })
  if (!result.ok) ElMessage.error(result.message || '列设置保存失败')
}

async function selectAllColumns() {
  const all = {}
  for (const column of ledger.columns) all[column.prop] = true
  Object.assign(visibilityDraft, all)
  await persistVisibility()
  ElMessage.success('已显示全部列')
}

async function resetColumns() {
  const defaults = {}
  for (const column of ledger.columns) defaults[column.prop] = true
  Object.assign(visibilityDraft, defaults)
  await persistVisibility()
  ElMessage.success('列设置已恢复默认')
}

function tagStyle(color) {
  return {
    '--el-tag-text-color': color || '#409EFF',
    '--el-tag-border-color': color || '#409EFF',
    '--el-tag-bg-color': 'transparent',
  }
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

onMounted(() => {
  applyRouteQuery()
})

watch(
  () => route.fullPath,
  () => {
    if (route.name === 'contracts') applyRouteQuery()
  },
)
</script>
