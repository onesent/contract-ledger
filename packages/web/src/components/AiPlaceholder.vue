<template>
  <el-card class="ai-card" shadow="never">
    <template #header>
      <div class="card-header">
        <el-icon><MagicStick /></el-icon>
        <span class="card-header-title">AI 台账助手（能力预留）</span>
        <div class="card-header-spacer" />
        <el-tag :type="aiReady ? 'success' : 'info'" effect="plain" size="small">
          {{ aiReady ? '已配置' : '未配置' }}
        </el-tag>
      </div>
    </template>

    <div class="ai-query-row">
      <el-input
        v-model="question"
        :disabled="!aiReady"
        clearable
        placeholder="例如：本月到期且还有未收款的执行中合同"
        aria-label="用一句话查台账"
        @keyup.enter="ask"
      />
      <el-tooltip :disabled="aiReady" content="请在设置中配置 AI 后使用" placement="top">
        <span>
          <el-button type="primary" :disabled="!aiReady" :loading="loading" @click="ask">
            用一句话查台账
          </el-button>
        </span>
      </el-tooltip>
      <el-button v-if="!aiReady" text type="primary" @click="goSettings">前往配置</el-button>
    </div>

    <p class="ai-hint">
      未配置时入口禁用，不影响台账的其它功能；未配置 AI 时应用不会发起任何网络请求。
      演示数据与备份文件中不包含任何密钥。
    </p>
  </el-card>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { MagicStick } from '@element-plus/icons-vue'
import { useLedger } from '../composables/useLedger'
import { askLedger, isConfigured } from '../ai/provider'

const ledger = useLedger()
const router = useRouter()
const question = ref('')
const loading = ref(false)

const aiReady = computed(() => isConfigured(ledger.aiConfig.value))

function goSettings() {
  router.push({ path: '/settings', query: { section: 'ai' } })
}

async function ask() {
  if (!aiReady.value || loading.value) return
  if (!question.value.trim()) {
    ElMessage.warning('请输入一句话问题')
    return
  }
  loading.value = true
  try {
    const result = await askLedger(
      question.value,
      {
        fields: ['keyword', 'quick', 'typeCodes', 'statusCodes', 'signDateRange', 'dueDateRange', 'amountRange'],
        quick: ledger.quickFilters.map((item) => item.value),
      },
      ledger.aiConfig.value,
    )
    // 占位实现不会返回 filters；如实提示，不伪造筛选结果
    if (result.data && result.data.filters) {
      router.push({ path: '/contracts', query: { ...result.data.filters } })
    } else {
      ElMessage.info(result.message || 'AI 未返回可用筛选条件')
    }
  } finally {
    loading.value = false
  }
}
</script>
