<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head-text">
        <h2 class="page-title">{{ directionName }}</h2>
        <p class="page-subtitle">
          17 个字段分为「录入 / 派生 / 系统自动」三类；{{ funding.unpaid }}、{{ funding.progress }}与交付进度实时计算，不可手改。
        </p>
      </div>
      <div class="page-actions">
        <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
          <span>
            <el-button type="primary" :disabled="!writable" @click="openCreate">
              <el-icon><Plus /></el-icon>
              新增{{ directionName }}
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
      <el-form :model="filters" label-position="top" class="filter-form" @submit.prevent>
        <el-form-item label="关键词">
          <el-input
            v-model="filters.keyword"
            clearable
            :placeholder="`编号 / ${party} / 负责人 / 备注`"
            :prefix-icon="Search"
          />
        </el-form-item>
        <el-form-item label="快捷筛选">
          <el-select v-model="filters.quick" placeholder="全部合同">
            <el-option v-for="item in quickOptions" :key="item.value" :label="item.label" :value="item.value">
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
        <el-form-item label="负责人">
          <el-select v-model="filters.ownerIds" multiple collapse-tags collapse-tags-tooltip clearable placeholder="全部负责人">
            <el-option v-for="item in ownerFilterOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额区间（元）">
          <div class="range-inputs">
            <el-input-number v-model="filters.amountMin" :min="0" :step="1000" :controls="false" placeholder="最小" />
            <span class="range-sep">—</span>
            <el-input-number v-model="filters.amountMax" :min="0" :step="1000" :controls="false" placeholder="最大" />
          </div>
        </el-form-item>
        <el-form-item :label="`${funding.progress}（%）`">
          <div class="range-inputs">
            <el-input-number v-model="filters.progressMin" :min="0" :max="100" :step="10" :controls="false" placeholder="最小" />
            <span class="range-sep">—</span>
            <el-input-number v-model="filters.progressMax" :min="0" :max="100" :step="10" :controls="false" placeholder="最大" />
          </div>
        </el-form-item>
        <el-form-item label="交付进度（%）">
          <div class="range-inputs">
            <el-input-number v-model="filters.deliveryMin" :min="0" :max="100" :step="10" :controls="false" placeholder="最小" />
            <span class="range-sep">—</span>
            <el-input-number v-model="filters.deliveryMax" :min="0" :max="100" :step="10" :controls="false" placeholder="最大" />
          </div>
        </el-form-item>
        <el-form-item :label="`有${funding.unpaid}`">
          <el-switch v-model="filters.hasUnpaid" inline-prompt :active-text="unpaidShortText" inactive-text="全部" />
        </el-form-item>
      </el-form>

      <div class="filter-summary">
        <el-button size="small" @click="resetFilters">
          <el-icon><Refresh /></el-icon>
          清除筛选
        </el-button>
        <span class="small muted">
          共 {{ paginationTotal }} 条（本方向全部 {{ directionContracts.length }} 条）
          <span v-if="clientFilterActive">· 快捷 / 区间筛选在当前页内细化</span>
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
        :contracts="displayRows"
        :loading="ledger.loading.value"
        :visible="ledger.visibleColumns.value"
        :precision="precision"
        :default-sort="defaultSort"
        :writable="writable"
        :direction="direction"
        @detail="openDetail"
        @edit="openEdit"
        @copy="openCopy"
        @delete="removeContract"
        @payment="openPayment"
        @delivery="openDelivery"
        @create="openCreate"
        @selection-change="onSelectionChange"
        @sort-change="onSortChange"
      />
      <div v-if="paginationTotal" class="pagination-bar">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="paginationTotal"
          :page-sizes="[10, 20, 50, 100]"
          background
          layout="total, sizes, prev, pager, next, jumper"
        />
      </div>
    </el-card>

    <!-- 窄屏卡片布局 -->
    <div v-else class="mobile-card-list">
      <el-card v-for="row in displayRows" :key="row.id" class="mobile-card" shadow="never">
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
          <el-descriptions-item :label="party">{{ row.customer }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ row.typeName }}</el-descriptions-item>
          <el-descriptions-item label="合同金额">{{ formatMoney(row.amount, precision) }}</el-descriptions-item>
          <el-descriptions-item :label="funding.received">{{ formatMoney(row.receivedAmount, precision) }}</el-descriptions-item>
          <el-descriptions-item label="已交付金额">{{ formatMoney(row.deliveredAmount, precision) }}</el-descriptions-item>
          <el-descriptions-item label="到期日">{{ formatDate(row.dueDate) }}</el-descriptions-item>
          <el-descriptions-item label="负责人">{{ row.ownerName }}</el-descriptions-item>
          <el-descriptions-item :label="funding.date">{{ formatDate(row.paymentDate) }}</el-descriptions-item>
        </el-descriptions>
        <div class="mobile-card-progress">
          <div class="progress-preview">
            <span class="small muted">{{ funding.progress }}</span>
            <el-progress
              v-if="row.fundingPercent !== null"
              :percentage="row.fundingPercent"
              :show-text="false"
              :stroke-width="8"
              :color="progressColor(row.fundingPercent)"
            />
            <span class="small" :class="{ muted: row.fundingPercent === null }">
              {{ row.fundingPercent === null ? '—' : formatPercent(row.fundingPercent, 1) }}
            </span>
          </div>
          <div class="progress-preview">
            <span class="small muted">交付进度</span>
            <el-progress
              v-if="row.deliveryPercent !== null"
              :percentage="row.deliveryPercent"
              :show-text="false"
              :stroke-width="8"
              :color="progressColor(row.deliveryPercent)"
            />
            <span class="small" :class="{ muted: row.deliveryPercent === null }">
              {{ row.deliveryPercent === null ? '—' : formatPercent(row.deliveryPercent, 1) }}
            </span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
            <span><el-button size="small" type="primary" :disabled="!writable" @click="openEdit(row)">编辑</el-button></span>
          </el-tooltip>
          <el-button size="small" type="success" :disabled="!writable || row.unpaid <= 0" @click="openPayment(row)">
            {{ funding.verb }}
          </el-button>
          <el-button
            size="small"
            type="warning"
            :disabled="!writable || (row.amount > 0 && row.deliveredAmount >= row.amount)"
            @click="openDelivery(row)"
          >
            交付
          </el-button>
          <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
            <span><el-button size="small" type="danger" plain :disabled="!writable" @click="removeContract(row)">删除</el-button></span>
          </el-tooltip>
        </div>
      </el-card>
      <el-empty v-if="!displayRows.length" description="暂无符合条件的合同">
        <el-button type="primary" :disabled="!writable" @click="openCreate">新增{{ directionName }}</el-button>
      </el-empty>
      <div v-if="paginationTotal" class="pagination-bar">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="paginationTotal"
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
        title="列显隐仅在本次会话内生效（设置写入将在后续版本开放；销售与采购共用同一列配置）"
        style="margin-bottom: 12px"
      />
      <el-checkbox-group v-model="visibleProps" class="column-checkbox-group" @change="persistVisibility">
        <el-checkbox v-for="column in directionColumns" :key="column.prop" :value="column.prop">
          {{ column.label }}
        </el-checkbox>
      </el-checkbox-group>
      <div class="section-actions">
        <el-button size="small" @click="selectAllColumns">全选</el-button>
        <el-button size="small" @click="resetColumns">恢复默认</el-button>
      </div>
    </el-drawer>

    <!-- 合同表单 -->
    <ContractForm
      v-model="formVisible"
      :contract="editingContract"
      :direction="direction"
      @saved="onSaved"
    />

    <!-- 合同详情 -->
    <ContractDetail
      v-model="detailVisible"
      :contract="detailContract"
      :direction="direction"
      @edit="openEdit"
      @payment="openPayment"
      @delivery="openDelivery"
      @delete-delivery="removeDelivery"
    />

    <!-- 登记收款 / 付款（按方向取义） -->
    <el-dialog v-model="paymentVisible" :title="`登记${funding.verb}`" width="480px" append-to-body destroy-on-close>
      <el-alert
        v-if="paymentContract"
        type="info"
        :closable="false"
        :title="`${paymentContract.no} · ${paymentContract.customer}`"
        style="margin-bottom: 12px"
      >
        合同金额 {{ formatMoney(paymentContract.amount, precision) }}，{{ funding.received }}
        {{ formatMoney(paymentContract.receivedAmount, precision) }}，剩余
        <b>{{ formatMoney(paymentRemaining, precision) }}</b>
      </el-alert>
      <el-form ref="paymentFormRef" :model="paymentForm" :rules="paymentFormRules" label-width="auto">
        <el-form-item :label="`${funding.verb}金额`" prop="amount">
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
        <el-form-item :label="`${funding.verb}日期`" prop="date">
          <el-date-picker
            v-model="paymentForm.date"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            :placeholder="`请选择${funding.verb}日期`"
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

    <!-- 登记交付 -->
    <el-dialog v-model="deliveryVisible" title="登记交付" width="480px" append-to-body destroy-on-close>
      <el-alert
        v-if="deliveryContract"
        type="info"
        :closable="false"
        :title="`${deliveryContract.no} · ${deliveryContract.customer}`"
        style="margin-bottom: 12px"
      >
        合同金额 {{ formatMoney(deliveryContract.amount, precision) }}，已交付
        {{ formatMoney(deliveryContract.deliveredAmount, precision) }}，剩余可交付
        <b>{{ formatMoney(deliveryRemaining, precision) }}</b>
      </el-alert>
      <el-form ref="deliveryFormRef" :model="deliveryForm" :rules="deliveryFormRules" label-width="auto">
        <el-form-item label="交付日期" prop="date">
          <el-date-picker
            v-model="deliveryForm.date"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            placeholder="请选择交付日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="本次交付金额" prop="amount">
          <el-input-number
            v-model="deliveryForm.amount"
            :min="0.01"
            :max="deliveryRemaining"
            :precision="precision"
            :step="1000"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="数量" prop="quantity">
          <el-input-number
            v-model="deliveryForm.quantity"
            :min="0"
            :controls="false"
            placeholder="选填，仅作描述不参与计算"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="单位" prop="unit">
          <el-input v-model="deliveryForm.unit" maxlength="12" placeholder="选填，例如 套 / 批 / 台" />
        </el-form-item>
        <el-form-item label="验收状态" prop="status">
          <el-select v-model="deliveryForm.status" placeholder="请选择验收状态" style="width: 100%">
            <el-option
              v-for="(meta, key) in ledger.deliveryStatusMeta"
              :key="key"
              :label="meta.name"
              :value="key"
            />
          </el-select>
          <div class="derived-hint">验收驳回不计入已交付金额，但保留在明细中可追溯</div>
        </el-form-item>
        <el-form-item label="备注" prop="note">
          <el-input v-model="deliveryForm.note" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deliveryVisible = false">取消</el-button>
        <el-button type="primary" :loading="deliverySaving" @click="submitDelivery">确认登记</el-button>
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
import { deliveryRules, paymentRules } from '../utils/validate'
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

// ---------- 方向上下文（销售 / 采购两个入口共用本视图） ----------
const direction = computed(() => (route.meta && route.meta.direction === 'purchase' ? 'purchase' : 'sale'))
const directionName = computed(() => ledger.directionLabel(direction.value))
const party = computed(() => ledger.partyLabel(direction.value))
const funding = computed(() => ledger.fundingLabels(direction.value))
const unpaidShortText = computed(() => (direction.value === 'purchase' ? '仅未付' : '仅未收'))

/** 快捷筛选按方向换文案（提醒跳转的 overdueDelivery 等键也有兜底标签）。 */
const quickTexts = computed(() => {
  const purchase = direction.value === 'purchase'
  return {
    overdueUnpaid: { label: purchase ? '逾期未付' : '逾期未收', description: `存在${purchase ? '未付' : '未收'}金额且超过逾期判定天数` },
    zeroReceived: { label: purchase ? '执行中未付款' : '执行中未收款', description: `已开始执行但${purchase ? '已付' : '已收'}金额为 0` },
    unpaid: { label: purchase ? '有未付金额' : '有未收金额', description: `${purchase ? '未付' : '未收'}金额大于 0` },
    received: { label: purchase ? '已产生付款' : '已产生收款', description: `${purchase ? '已付' : '已收'}金额大于 0` },
    deliveredUnfunded: {
      label: purchase ? '已到货未付款' : '已交付未收款',
      description: purchase ? '已到货金额大于 0 且仍有未付金额' : '已交付金额大于 0 且仍有未收金额',
    },
    fundedUndelivered: {
      label: purchase ? '已付款未到货' : '已收款未交付',
      description: purchase ? '已付金额大于已到货金额（资金先行）' : '已收金额大于已交付金额（资金先行）',
    },
    overdueDelivery: { label: '超期未交付', description: purchase ? '已过到期日且到货进度未达 100%' : '已过到期日且交付进度未达 100%' },
    prepaidUndelivered: {
      label: purchase ? '已付款未到货' : '已收款未交付',
      description: purchase ? '已付金额大于已到货金额且合同未完结' : '已收金额大于已交付金额且合同未完结',
    },
  }
})
const quickOptions = computed(() =>
  ledger.quickFilters.map((item) => {
    const override = quickTexts.value[item.value]
    return override ? { ...item, label: override.label, description: override.description } : { ...item }
  }),
)
function quickLabel(value) {
  const override = quickTexts.value[value]
  if (override) return override.label
  const option = ledger.quickFilters.find((item) => item.value === value)
  return option ? option.label : value
}

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
  deliveryMin: null,
  deliveryMax: null,
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

/** 当前方向的合同全量快照（详情 / 弹窗 / 客户端筛选兜底用；销售入口看不到采购合同）。 */
const directionContracts = computed(() => ledger.contractsByDirection.value[direction.value] || [])

/** 表格 prop → 服务端排序字段（未列出的 prop 走客户端管线）。 */
const SERVER_SORT_FIELDS = {
  no: 'no',
  customer: 'counterparty',
  amount: 'amountCents',
  unpaid: 'unpaidCents',
  percent: 'fundingPercent',
  dueDate: 'dueDate',
  signDate: 'signDate',
  updatedAt: 'updatedAt',
}

const hasNumber = (value) => value !== null && value !== undefined && value !== ''

/** 服务端无法表达的筛选（快捷 / 类型 / 多值 / 区间 / 日期）→ 触发客户端管线。 */
const clientFilterActive = computed(() =>
  filters.quick !== 'all' ||
  filters.typeCodes.length > 0 ||
  filters.statusCodes.length > 1 ||
  filters.ownerIds.length > 1 ||
  Boolean(filters.signedFrom || filters.signedTo || filters.dueFrom || filters.dueTo) ||
  hasNumber(filters.amountMin) ||
  hasNumber(filters.amountMax) ||
  hasNumber(filters.progressMin) ||
  hasNumber(filters.progressMax) ||
  hasNumber(filters.deliveryMin) ||
  hasNumber(filters.deliveryMax) ||
  filters.hasUnpaid,
)

/** 排序列是否可交给服务端。 */
const serverSortActive = computed(() => Boolean(sort.order) && Boolean(SERVER_SORT_FIELDS[sort.prop]))

/**
 * 客户端管线：存在服务端不支持的筛选或排序时，基于全量快照本地筛选 / 排序 / 分页；
 * 否则列表完全由服务端分页驱动（page/pageSize/search/status/owner/sort → /api/contracts）。
 */
const useClientPipeline = computed(() => clientFilterActive.value || !serverSortActive.value)

const filtered = computed(() => {
  if (!useClientPipeline.value) return directionContracts.value
  const keyword = filters.keyword.trim().toLowerCase()
  return directionContracts.value.filter((contract) => {
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
    if (hasNumber(filters.amountMin) && toNumber(contract.amount) < filters.amountMin) return false
    if (hasNumber(filters.amountMax) && toNumber(contract.amount) > filters.amountMax) return false
    if (hasNumber(filters.progressMin)) {
      if (contract.fundingPercent === null || contract.fundingPercent < filters.progressMin) return false
    }
    if (hasNumber(filters.progressMax)) {
      if (contract.fundingPercent === null || contract.fundingPercent > filters.progressMax) return false
    }
    // 交付进度区间：金额为 0（进度为 null，显示「—」）的合同在设定区间时被排除
    if (hasNumber(filters.deliveryMin)) {
      if (contract.deliveryPercent === null || contract.deliveryPercent < filters.deliveryMin) return false
    }
    if (hasNumber(filters.deliveryMax)) {
      if (contract.deliveryPercent === null || contract.deliveryPercent > filters.deliveryMax) return false
    }
    if (filters.hasUnpaid && contract.unpaid <= 0) return false
    return true
  })
})

const sorted = computed(() => {
  if (!useClientPipeline.value) return filtered.value
  const list = filtered.value.slice()
  if (!sort.prop || !sort.order) return list
  const dir = sort.order === 'ascending' ? 1 : -1
  const valueOf = (row) => {
    switch (sort.prop) {
      case 'typeCode':
        return row.typeName
      case 'statusCode':
        return row.statusName
      case 'percent':
        return row.fundingPercent === null ? -1 : row.fundingPercent
      case 'deliveryProgress':
        return row.deliveryPercent === null ? -1 : row.deliveryPercent
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
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av).localeCompare(String(bv), 'zh') * dir
  })
  return list
})

/** 服务端分页的当前页（enriched 后由 useLedger 提供）。 */
const serverRows = computed(() => ledger.pageContracts.value)

/** 最终展示行：客户端管线本地分页；服务端管线直接用当前页。 */
const displayRows = computed(() => {
  if (!useClientPipeline.value) return serverRows.value
  const start = (currentPage.value - 1) * pageSize.value
  return sorted.value.slice(start, start + pageSize.value)
})

/** 分页总数：客户端管线用筛选结果数，服务端管线用服务端 total。 */
const paginationTotal = computed(() =>
  useClientPipeline.value ? sorted.value.length : ledger.total.value,
)

/** 把服务端可表达的查询参数推给 useLedger（含分页）。 */
function syncListQuery() {
  if (useClientPipeline.value) return
  void ledger.actions.setListQuery({
    page: currentPage.value,
    pageSize: pageSize.value,
    direction: direction.value,
    search: filters.keyword.trim(),
    status: filters.statusCodes.length === 1 ? filters.statusCodes[0] : '',
    owner: filters.ownerIds.length === 1 ? filters.ownerIds[0] : '',
    sortBy: SERVER_SORT_FIELDS[sort.prop] || 'updatedAt',
    sortOrder: sort.order === 'ascending' ? 'asc' : 'desc',
  })
}

let syncTimer = 0
function requestSync() {
  window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(syncListQuery, 250)
}

const activeFilterTags = computed(() => {
  const tags = []
  if (filters.quick && filters.quick !== 'all') {
    tags.push({ key: 'quick', text: `快捷：${quickLabel(filters.quick)}` })
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
      text: `${funding.value.progress}：${hasNumber(filters.progressMin) ? filters.progressMin : 0}% ~ ${
        hasNumber(filters.progressMax) ? filters.progressMax : 100
      }%`,
    })
  }
  if (hasNumber(filters.deliveryMin) || hasNumber(filters.deliveryMax)) {
    tags.push({
      key: 'delivery',
      text: `交付进度：${hasNumber(filters.deliveryMin) ? filters.deliveryMin : 0}% ~ ${
        hasNumber(filters.deliveryMax) ? filters.deliveryMax : 100
      }%`,
    })
  }
  if (filters.hasUnpaid) tags.push({ key: 'unpaid', text: `仅有${funding.value.unpaid}` })
  return tags
})

const detailContract = computed(
  () => directionContracts.value.find((item) => item.id === detailId.value) || null,
)

watch(
  () => ledger.settings.value.pageSize,
  (value) => {
    pageSize.value = Number(value) || 20
    currentPage.value = 1
    requestSync()
  },
)

watch(
  () => [filters.keyword, filters.quick, filters.typeCodes.length, filters.statusCodes.length, filters.ownerIds.length, filters.signedFrom, filters.signedTo, filters.dueFrom, filters.dueTo, filters.amountMin, filters.amountMax, filters.progressMin, filters.progressMax, filters.deliveryMin, filters.deliveryMax, filters.hasUnpaid],
  () => {
    currentPage.value = 1
    requestSync()
  },
)

watch(
  () => [sort.prop, sort.order],
  () => {
    currentPage.value = 1
    requestSync()
  },
)

// 翻页 / 每页条数：服务端分页模式下重新取当前页。
watch([currentPage, pageSize], () => {
  requestSync()
})

// 客户端 / 服务端管线切换：切回服务端时立即取页。
watch(useClientPipeline, (clientMode) => {
  if (!clientMode) requestSync()
})

// 切换销售 / 采购入口时重置分页，避免停留在越界页码
watch(direction, () => {
  currentPage.value = 1
  clearSelection()
  requestSync()
})

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
  filters.deliveryMin = null
  filters.deliveryMax = null
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
    case 'delivery':
      filters.deliveryMin = null
      filters.deliveryMax = null
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
  filters.deliveryMin = query.deliveryMin !== undefined && query.deliveryMin !== '' ? Number(query.deliveryMin) : null
  filters.deliveryMax = query.deliveryMax !== undefined && query.deliveryMax !== '' ? Number(query.deliveryMax) : null
  filters.hasUnpaid = query.unpaid === '1'

  const action = typeof query.action === 'string' ? query.action : ''
  const detail = typeof query.detail === 'string' ? query.detail : ''
  if (action === 'create') openCreate()
  if (detail) openDetailById(detail)
  if (action || detail) {
    const nextQuery = { ...query }
    delete nextQuery.action
    delete nextQuery.detail
    router.replace({ path: route.path, query: nextQuery })
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
    ElMessage.warning(`当前为只读模式，无法新增${directionName.value}`)
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
  const row = directionContracts.value.find((item) => item.id === id)
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
      `确认删除合同「${row.no} · ${row.customer}」？关联的${funding.value.verb}流水与交付明细会一并删除，此操作不可撤销。`,
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
      `确认删除选中的 ${selectedIds.value.length} 份合同？关联的${funding.value.verb}流水与交付明细会一并删除，此操作不可撤销。`,
      '批量删除',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  const result = await ledger.actions.deleteContracts(selectedIds.value)
  if (result.ok) {
    const deliveryPart = result.deliveries ? `、${result.deliveries} 条交付明细` : ''
    ElMessage.success(
      `已删除 ${result.contracts} 份合同、${result.payments} 条${funding.value.verb}流水${deliveryPart}`,
    )
    clearSelection()
    detailVisible.value = false
  } else {
    ElMessage.error(result.message || '批量删除失败')
  }
}

// ---------- 登记收款 / 付款 ----------
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
  () => directionContracts.value.find((item) => item.id === paymentForm.contractId) || null,
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
    ElMessage.warning(`当前为只读模式，无法登记${funding.value.verb}`)
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
    ElMessage.warning(`请检查${funding.value.verb}金额、日期与付款方式`)
    return
  }
  paymentSaving.value = true
  try {
    const result = await ledger.actions.registerPayment({ ...paymentForm })
    if (result.ok) {
      ElMessage.success(
        `已登记${funding.value.verb} ${formatMoney(result.payment.amount, precision.value)}，合同${funding.value.received}已累加`,
      )
      paymentVisible.value = false
    } else {
      ElMessage.error(result.message || `登记${funding.value.verb}失败`)
    }
  } finally {
    paymentSaving.value = false
  }
}

// ---------- 登记交付 ----------
const deliveryVisible = ref(false)
const deliverySaving = ref(false)
const deliveryFormRef = ref(null)
const deliveryForm = reactive({
  contractId: '',
  date: dayjs().format('YYYY-MM-DD'),
  amount: 0,
  quantity: null,
  unit: '',
  status: ledger.deliveryStatus.DELIVERED,
  note: '',
})

const deliveryContract = computed(
  () => directionContracts.value.find((item) => item.id === deliveryForm.contractId) || null,
)
const deliveryRemaining = computed(() => {
  if (!deliveryContract.value) return 0
  const remaining = toNumber(deliveryContract.value.amount) - toNumber(deliveryContract.value.deliveredAmount)
  return Math.max(0, Math.round(remaining * 100) / 100)
})

const deliveryFormRules = computed(() =>
  deliveryRules({
    getMax: () => deliveryRemaining.value,
    precision: precision.value,
  }),
)

function remainingOf(row) {
  const remaining = toNumber(row.amount) - toNumber(row.deliveredAmount)
  return Math.max(0, Math.round(remaining * 100) / 100)
}

function openDelivery(row) {
  if (!writable.value) {
    ElMessage.warning('当前为只读模式，无法登记交付')
    return
  }
  deliveryForm.contractId = row.id
  deliveryForm.date = dayjs().format('YYYY-MM-DD')
  deliveryForm.amount = remainingOf(row)
  deliveryForm.quantity = null
  deliveryForm.unit = ''
  deliveryForm.status = ledger.deliveryStatus.DELIVERED
  deliveryForm.note = ''
  deliveryVisible.value = true
  nextTick(() => {
    if (deliveryFormRef.value) deliveryFormRef.value.clearValidate()
  })
}

async function submitDelivery() {
  if (!deliveryFormRef.value) return
  try {
    await deliveryFormRef.value.validate()
  } catch {
    ElMessage.warning('请检查交付金额、日期与验收状态')
    return
  }
  deliverySaving.value = true
  try {
    const result = await ledger.actions.registerDelivery({ ...deliveryForm })
    if (result.ok) {
      ElMessage.success(
        `已登记交付 ${formatMoney(result.delivery.amount, precision.value)}，合同已交付金额已累加`,
      )
      deliveryVisible.value = false
    } else {
      ElMessage.error(result.message || '登记交付失败')
    }
  } finally {
    deliverySaving.value = false
  }
}

async function removeDelivery(delivery) {
  if (!writable.value) {
    ElMessage.warning('当前为只读模式，无法删除交付记录')
    return
  }
  if (!delivery || !delivery.id) return
  try {
    await ElMessageBox.confirm(
      `确认删除 ${delivery.date || '—'} 的交付记录（${formatMoney(delivery.amount, precision.value)} 元）？合同已交付金额会同步回退，此操作不可撤销。`,
      '删除交付记录',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  const result = await ledger.actions.deleteDelivery(delivery.id)
  if (result.ok) {
    ElMessage.success('已删除交付记录，合同已交付金额已回退')
  } else {
    ElMessage.error(result.message || '删除交付记录失败')
  }
}

// ---------- 列显隐 ----------
const columnDrawer = ref(false)
/** 列定义按方向解析 label；prop 不变，columnVisibility 仍为方向无关的同一份设置。 */
const directionColumns = computed(() => ledger.columnsFor(direction.value))
const visibilityDraft = reactive({ ...ledger.settings.value.columnVisibility })
const visibleProps = computed({
  get: () =>
    directionColumns.value.filter((column) => visibilityDraft[column.prop] !== false).map((column) => column.prop),
  set: (props) => {
    for (const column of directionColumns.value) {
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
  for (const column of directionColumns.value) all[column.prop] = true
  Object.assign(visibilityDraft, all)
  await persistVisibility()
  ElMessage.success('已显示全部列')
}

async function resetColumns() {
  const defaults = {}
  for (const column of directionColumns.value) defaults[column.prop] = true
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

/** 与表格两条进度条同一配色口径。 */
function progressColor(percent) {
  if (percent === null || percent === undefined) return '#c0c4cc'
  if (percent >= 100) return '#2f9e63'
  if (percent >= 60) return '#409eff'
  return '#d9932f'
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
  // 初次挂载：把当前筛选 / 分页 / 排序推给服务端取第一页。
  syncListQuery()
})

watch(
  () => route.fullPath,
  () => {
    if (route.meta && route.meta.direction) applyRouteQuery()
  },
)
</script>
