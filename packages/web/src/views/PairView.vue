<template>
  <div class="pair-page">
    <el-card class="pair-card" shadow="never">
      <template #header>
        <div class="card-header">
          <el-icon><Link /></el-icon>
          <span class="card-header-title">连接本地台账服务</span>
        </div>
      </template>

      <el-alert
        v-if="auth.error.value"
        type="error"
        show-icon
        :closable="false"
        :title="auth.error.value"
        style="margin-bottom: 14px"
      />
      <el-alert
        v-else
        type="info"
        show-icon
        :closable="false"
        title="首次使用需要配对"
        style="margin-bottom: 14px"
      >
        请回到启动本地服务的终端，复制「一次性配对码」（有效期 120 秒、仅可使用一次）粘贴到下方；
        配对成功后浏览器会获得本机会话，数据仍只保存在这台机器上。
      </el-alert>

      <el-form :model="form" label-position="top" @submit.prevent="submit">
        <el-form-item label="配对码">
          <el-input
            v-model="form.code"
            size="large"
            clearable
            maxlength="12"
            placeholder="例如 K7M2Q9XW"
            :prefix-icon="Key"
            @keyup.enter="submit"
          />
        </el-form-item>
        <div class="pair-actions">
          <el-button type="primary" size="large" :loading="auth.loading.value" @click="submit">
            配对并进入
          </el-button>
        </div>
      </el-form>

      <p class="pair-hint">
        配对码错误 5 次或过期后请重启本地服务获取新码；服务只监听 127.0.0.1，局域网无法访问。
      </p>
    </el-card>
  </div>
</template>

<script setup>
import { reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Key, Link } from '@element-plus/icons-vue'
import { auth, submitPair } from '../api/auth'

const route = useRoute()
const router = useRouter()
const form = reactive({ code: '' })

async function submit() {
  const result = await submitPair(form.code)
  if (result.ok) {
    ElMessage.success('配对成功，会话已建立')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/home'
    router.replace(redirect)
  }
}
</script>

<style scoped>
.pair-page {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 8vh 16px 24px;
}

.pair-card {
  width: 100%;
  max-width: 480px;
}

.pair-actions {
  display: flex;
  justify-content: flex-end;
}

.pair-hint {
  margin: 14px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.7;
}
</style>
