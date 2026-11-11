<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <el-icon><Bell /></el-icon>
        <span class="card-header-title">提醒清单</span>
        <el-badge v-if="total > 0" :value="total" type="danger" :max="99" />
        <el-tag v-else type="success" effect="plain" size="small">全部处理完毕</el-tag>
        <div class="card-header-spacer" />
        <el-tooltip content="恢复所有「本次忽略」的提醒（不会修改业务数据）" placement="top">
          <el-button link type="primary" size="small" :disabled="!hasIgnored" @click="restoreIgnored">
            恢复已忽略
          </el-button>
        </el-tooltip>
      </div>
    </template>

    <el-empty v-if="total === 0 && !hasIgnored" description="暂无待处理提醒" :image-size="80" />

    <div v-else class="reminder-groups">
      <div v-for="group in visibleGroups" :key="group.key" class="reminder-group">
        <div class="reminder-head">
          <el-tag :type="group.type" effect="plain">{{ group.title }}</el-tag>
          <span class="reminder-count">{{ group.count }} 条</span>
          <el-tooltip :content="group.description" placement="top">
            <el-icon class="muted"><InfoFilled /></el-icon>
          </el-tooltip>
          <span v-if="group.ignoredCount > 0" class="reminder-desc">已忽略 {{ group.ignoredCount }} 条</span>
          <div class="card-header-spacer" />
          <el-button link type="primary" size="small" @click="emit('jump', group.quick)">
            查看全部
            <el-icon><ArrowRight /></el-icon>
          </el-button>
        </div>

        <div v-if="group.count === 0" class="reminder-empty-line">当前没有符合条件的合同</div>
        <ul v-else class="reminder-items">
          <li v-for="item in group.items" :key="item.id">
            <el-button link type="primary" @click="emit('open', item.id)">
              {{ item.no }} · {{ item.customer }}
            </el-button>
            <span class="muted">
              {{ item.dueDate ? `到期 ${item.dueDate}` : '到期日缺失' }}
            </span>
            <span v-if="item.unpaid > 0" class="text-danger">
              未收 {{ formatMoney(item.unpaid, precision) }}
            </span>
            <span v-if="item.issues && item.issues.length" class="text-warning small">
              {{ item.issues.join('；') }}
            </span>
            <el-tooltip content="本次忽略（写入设置，不删除任何数据）" placement="top">
              <el-button link size="small" @click="emit('ignore', item.ignoreKey)">忽略</el-button>
            </el-tooltip>
          </li>
        </ul>
        <div v-if="group.count > group.items.length" class="reminder-empty-line">
          仅展示前 {{ group.items.length }} 条，点击「查看全部」在列表中核对。
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue'
import { ArrowRight, Bell, InfoFilled } from '@element-plus/icons-vue'
import { formatMoney } from '../utils/format'

const props = defineProps({
  reminders: { type: Array, default: () => [] },
  precision: { type: Number, default: 2 },
  ignoredKeys: { type: Array, default: () => [] },
})

const emit = defineEmits(['jump', 'open', 'ignore', 'restore'])

const total = computed(() => props.reminders.reduce((sum, group) => sum + (group.count || 0), 0))
const hasIgnored = computed(
  () => props.ignoredKeys.length > 0 || props.reminders.some((group) => (group.ignoredCount || 0) > 0),
)
const visibleGroups = computed(() => props.reminders)

function restoreIgnored() {
  emit('restore')
}
</script>
