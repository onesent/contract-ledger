<template>
  <el-table
    ref="tableRef"
    :data="contracts"
    v-loading="loading"
    row-key="id"
    border
    stripe
    :row-class-name="rowClassName"
    :default-sort="defaultSort"
    @selection-change="handleSelectionChange"
    @sort-change="handleSortChange"
    @row-dblclick="(row) => emit('detail', row)"
  >
    <el-table-column type="selection" width="44" fixed="left" :selectable="() => writable" />

    <el-table-column v-if="show('no')" prop="no" label="合同编号" width="158" sortable="custom" fixed="left">
      <template #default="{ row }">
        <el-button link type="primary" @click="emit('detail', row)">{{ row.no }}</el-button>
      </template>
    </el-table-column>

    <el-table-column v-if="show('customer')" prop="customer" :label="labelOf('customer')" min-width="190" show-overflow-tooltip>
      <template #default="{ row }">
        <span>{{ row.customer }}</span>
      </template>
    </el-table-column>

    <el-table-column v-if="show('typeName')" prop="typeCode" label="合同类型" width="112" sortable="custom">
      <template #default="{ row }">
        <el-tag effect="plain" size="small" :style="tagStyle(row.typeColor)">{{ row.typeName }}</el-tag>
      </template>
    </el-table-column>

    <el-table-column
      v-if="show('amount')"
      prop="amount"
      label="合同金额"
      width="140"
      align="right"
      sortable="custom"
    >
      <template #default="{ row }">
        <span class="money-cell">{{ formatMoney(row.amount, precision) }}</span>
      </template>
    </el-table-column>

    <el-table-column
      v-if="show('receivedAmount')"
      prop="receivedAmount"
      :label="labelOf('receivedAmount')"
      width="140"
      align="right"
      sortable="custom"
    >
      <template #default="{ row }">
        <span class="money-cell">{{ formatMoney(row.receivedAmount, precision) }}</span>
      </template>
    </el-table-column>

    <el-table-column v-if="show('unpaid')" prop="unpaid" :label="labelOf('unpaid')" width="140" align="right" sortable="custom">
      <template #default="{ row }">
        <span class="money-cell" :class="{ 'is-unpaid': row.unpaid > 0 }">
          {{ formatMoney(row.unpaid, precision) }}
        </span>
      </template>
    </el-table-column>

    <el-table-column v-if="show('progress')" prop="percent" :label="labelOf('progress')" width="180" sortable="custom">
      <template #default="{ row }">
        <div class="cell-progress">
          <el-progress
            v-if="row.fundingPercent !== null"
            :percentage="row.fundingPercent"
            :show-text="false"
            :stroke-width="8"
            :color="progressColor(row.fundingPercent)"
          />
          <span class="cell-progress-text">{{ row.fundingPercent === null ? '—' : formatPercent(row.fundingPercent, 0) }}</span>
        </div>
      </template>
    </el-table-column>

    <el-table-column
      v-if="show('deliveryProgress')"
      prop="deliveryProgress"
      :label="labelOf('deliveryProgress')"
      width="180"
      sortable="custom"
    >
      <template #default="{ row }">
        <div class="cell-progress">
          <el-progress
            v-if="row.deliveryPercent !== null"
            :percentage="row.deliveryPercent"
            :show-text="false"
            :stroke-width="8"
            :color="progressColor(row.deliveryPercent)"
          />
          <span class="cell-progress-text">{{ row.deliveryPercent === null ? '—' : formatPercent(row.deliveryPercent, 0) }}</span>
        </div>
      </template>
    </el-table-column>

    <el-table-column v-if="show('paymentDate')" prop="paymentDate" :label="labelOf('paymentDate')" width="122" sortable="custom">
      <template #default="{ row }">{{ formatDate(row.paymentDate) }}</template>
    </el-table-column>

    <el-table-column v-if="show('signDate')" prop="signDate" label="签订日期" width="122" sortable="custom">
      <template #default="{ row }">{{ formatDate(row.signDate) }}</template>
    </el-table-column>

    <el-table-column v-if="show('dueDate')" prop="dueDate" label="到期日" width="128" sortable="custom">
      <template #default="{ row }">
        <span :class="{ 'text-danger': row.overdue, 'text-warning': !row.overdue && row.dueSoon }">
          {{ formatDate(row.dueDate) }}
        </span>
        <el-tooltip v-if="row.issues && row.issues.length" :content="row.issues.join('；')" placement="top">
          <el-icon class="text-warning" style="margin-left: 4px"><Warning /></el-icon>
        </el-tooltip>
      </template>
    </el-table-column>

    <el-table-column v-if="show('statusName')" prop="statusCode" label="状态" width="108" sortable="custom">
      <template #default="{ row }">
        <el-tag effect="plain" size="small" :style="tagStyle(row.statusColor)">{{ row.statusName }}</el-tag>
      </template>
    </el-table-column>

    <el-table-column v-if="show('ownerName')" prop="ownerName" label="负责人" width="112" show-overflow-tooltip>
      <template #default="{ row }">
        <span>{{ row.ownerName }}</span>
        <el-tooltip v-if="row.ownerActive === false" content="该负责人已离职，合同保留姓名快照" placement="top">
          <el-icon class="text-warning" style="margin-left: 4px"><UserFilled /></el-icon>
        </el-tooltip>
      </template>
    </el-table-column>

    <el-table-column
      v-if="show('statusChangedAt')"
      prop="statusChangedAt"
      label="状态变更时间"
      width="172"
      sortable="custom"
    >
      <template #default="{ row }">
        <span class="muted">{{ formatDateTime(row.statusChangedAt) }}</span>
      </template>
    </el-table-column>

    <el-table-column v-if="show('note')" prop="note" label="备注" min-width="180" show-overflow-tooltip />

    <el-table-column v-if="show('createdAt')" prop="createdAt" label="创建时间" width="172" sortable="custom">
      <template #default="{ row }">
        <span class="muted">{{ formatDateTime(row.createdAt) }}</span>
      </template>
    </el-table-column>

    <el-table-column v-if="show('updatedAt')" prop="updatedAt" label="更新时间" width="172" sortable="custom">
      <template #default="{ row }">
        <span class="muted">{{ formatDateTime(row.updatedAt) }}</span>
      </template>
    </el-table-column>

    <el-table-column label="操作" width="252" fixed="right">
      <template #default="{ row }">
        <div class="cell-actions">
          <el-tooltip content="查看详情" placement="top">
            <el-button link type="primary" aria-label="查看详情" @click="emit('detail', row)">
              <el-icon><View /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
            <span>
              <el-button link type="primary" :disabled="!writable" @click="emit('edit', row)">编辑</el-button>
            </span>
          </el-tooltip>
          <el-tooltip
            :content="!writable ? '仅可浏览与导出（当前为只读模式）' : row.unpaid > 0 ? `登记一笔${funding.verb}` : `该合同没有${funding.unpaid}`"
            placement="top"
          >
            <span>
              <el-button link type="success" :disabled="!writable || row.unpaid <= 0" @click="emit('payment', row)">
                {{ funding.verb }}
              </el-button>
            </span>
          </el-tooltip>
          <el-tooltip
            :content="!writable ? '仅可浏览与导出（当前为只读模式）' : row.amount > 0 && row.deliveredAmount >= row.amount ? '该合同已全部交付' : '登记一笔交付'"
            placement="top"
          >
            <span>
              <el-button
                link
                type="warning"
                :disabled="!writable || (row.amount > 0 && row.deliveredAmount >= row.amount)"
                @click="emit('delivery', row)"
              >
                交付
              </el-button>
            </span>
          </el-tooltip>
          <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
            <span>
              <el-dropdown trigger="click" :disabled="!writable" @command="(command) => handleCommand(command, row)">
                <el-button link type="primary" :disabled="!writable">
                  更多<el-icon><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="copy">复制新增</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </span>
          </el-tooltip>
        </div>
      </template>
    </el-table-column>

    <template #empty>
      <el-empty description="暂无符合条件的合同" :image-size="90">
        <el-tooltip :disabled="writable" content="仅可浏览与导出（当前为只读模式）" placement="top">
          <span>
            <el-button type="primary" :disabled="!writable" @click="emit('create')">新增{{ directionName }}</el-button>
          </span>
        </el-tooltip>
      </el-empty>
    </template>
  </el-table>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ArrowDown, UserFilled, View, Warning } from '@element-plus/icons-vue'
import { useLedger } from '../composables/useLedger'
import { formatDate, formatDateTime, formatMoney, formatPercent } from '../utils/format'

const tableRef = ref(null)
const ledger = useLedger()

const props = defineProps({
  contracts: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  visible: { type: Object, default: () => ({}) },
  precision: { type: Number, default: 2 },
  defaultSort: { type: Object, default: () => ({}) },
  writable: { type: Boolean, default: true },
  direction: { type: String, default: 'sale' },
})

const emit = defineEmits([
  'detail',
  'edit',
  'copy',
  'delete',
  'payment',
  'delivery',
  'create',
  'selection-change',
  'sort-change',
])

/** 列标题按方向解析（来自 ledger.columnsFor，prop 不变仅 label 换义）。 */
const columnLabels = computed(() => {
  /** @type {Record<string, string>} */
  const map = {}
  for (const column of ledger.columnsFor(props.direction)) map[column.prop] = column.label
  return map
})

const funding = computed(() => ledger.fundingLabels(props.direction))
const directionName = computed(() => ledger.directionLabel(props.direction))

function labelOf(prop) {
  return columnLabels.value[prop] || prop
}

function show(prop) {
  return props.visible[prop] !== false
}

function rowClassName({ row }) {
  if (row.overdue) return 'row-overdue'
  if (row.dueSoon) return 'row-due-soon'
  return ''
}

function tagStyle(color) {
  return {
    '--el-tag-text-color': color || '#409EFF',
    '--el-tag-border-color': color || '#409EFF',
    '--el-tag-bg-color': 'transparent',
  }
}

/** 进度条颜色：按百分比取值，资金 / 交付两条进度共用。 */
function progressColor(percent) {
  if (percent === null || percent === undefined) return '#c0c4cc'
  if (percent >= 100) return '#2f9e63'
  if (percent >= 60) return '#409eff'
  return '#d9932f'
}

function handleSelectionChange(rows) {
  emit('selection-change', rows)
}

function handleSortChange(payload) {
  emit('sort-change', payload)
}

function handleCommand(command, row) {
  if (command === 'copy') emit('copy', row)
  else if (command === 'delete') emit('delete', row)
}

function clearSelection() {
  if (tableRef.value && typeof tableRef.value.clearSelection === 'function') {
    tableRef.value.clearSelection()
  }
}

defineExpose({ clearSelection })
</script>
