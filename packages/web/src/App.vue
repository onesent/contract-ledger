<template>
  <el-config-provider :locale="locale">
    <el-container class="app-shell">
      <!-- 桌面侧边导航：el-menu router 模式，配合 hash 路由 -->
      <el-aside v-if="!isNarrow" class="app-aside" :width="collapsed ? '64px' : '220px'">
        <div class="brand">
          <el-icon class="brand-icon"><Tickets /></el-icon>
          <span v-if="!collapsed" class="brand-text">合同管理台账</span>
        </div>
        <el-menu
          :default-active="activeMenu"
          :collapse="collapsed"
          :collapse-transition="false"
          router
          class="app-menu"
        >
          <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ item.label }}</template>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <!-- 窄屏导航抽屉 -->
      <el-drawer
        v-else
        v-model="drawerVisible"
        direction="ltr"
        size="240px"
        :with-header="false"
        class="nav-drawer"
      >
        <div class="brand" style="background: var(--ledger-aside-bg)">
          <el-icon class="brand-icon"><Tickets /></el-icon>
          <span class="brand-text">合同管理台账</span>
        </div>
        <el-menu :default-active="activeMenu" router class="app-menu" style="background: var(--ledger-aside-bg)" @select="drawerVisible = false">
          <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ item.label }}</template>
          </el-menu-item>
        </el-menu>
      </el-drawer>

      <el-container class="app-body">
        <el-header class="app-header" height="60px">
          <el-button
            v-if="isNarrow"
            text
            class="nav-trigger"
            aria-label="打开导航"
            @click="drawerVisible = true"
          >
            <el-icon size="20"><Expand /></el-icon>
          </el-button>
          <el-button
            v-else
            text
            class="nav-trigger"
            :aria-label="collapsed ? '展开导航' : '收起导航'"
            @click="collapsed = !collapsed"
          >
            <el-icon size="18"><component :is="collapsed ? Expand : Fold" /></el-icon>
          </el-button>
          <h1 class="app-title">合同管理台账工作台</h1>
          <span class="header-subtitle">{{ currentTitle }}</span>
          <div class="header-spacer" />
          <div class="header-actions">
            <el-tooltip :content="storageTip" placement="bottom">
              <el-tag :type="engineTagType" effect="plain" size="small">{{ storageInfo.engineLabel }}</el-tag>
            </el-tooltip>
            <el-tag v-if="!storageInfo.writable" type="danger" effect="plain" size="small">只读</el-tag>
            <el-button v-if="auth.authenticated.value" text size="small" @click="signOut">
              退出配对
            </el-button>
          </div>
        </el-header>

        <el-main class="app-main">
          <!-- 只读模式横幅 -->
          <el-alert
            v-if="!storageInfo.writable"
            type="error"
            show-icon
            :closable="false"
            title="当前服务处于只读模式：写入已停止"
            style="margin-bottom: 14px"
          >
            {{ storageInfo.writeError?.message || storageInfo.lastError || '本地服务数据库当前不可写。' }}
            所有新增 / 编辑 / 删除入口已禁用，仅可浏览与导出。
            <div class="toolbar" style="margin-top: 8px">
              <el-button size="small" type="primary" @click="exportNow">立即导出备份</el-button>
              <el-button size="small" @click="go('/settings')">前往设置</el-button>
            </div>
          </el-alert>

          <router-view v-slot="{ Component }">
            <component :is="Component" />
          </router-view>
        </el-main>

        <el-footer class="app-footer" height="auto">
          <StorageStatus compact />
          <div class="footer-note">
            数据保存在本机 SQLite（仅 127.0.0.1 服务可访问）· 导出 JSON 是异地存档 · 应用不发起外部网络请求
          </div>
        </el-footer>
      </el-container>
    </el-container>
  </el-config-provider>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Collection,
  DataBoard,
  Expand,
  Fold,
  Sell,
  Setting,
  ShoppingCart,
  Tickets,
  User,
} from '@element-plus/icons-vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import StorageStatus from './components/StorageStatus.vue'
import { createLedger, provideLedger } from './composables/useLedger'
import { useMediaQuery } from './composables/useMediaQuery'
import { auth, signOut as endSession } from './api/auth'

const ledger = provideLedger(createLedger())
const route = useRoute()
const router = useRouter()
const isNarrow = useMediaQuery('(max-width: 1023px)')
const locale = inject('ep-locale', zhCn)

const collapsed = ref(false)
const drawerVisible = ref(false)

const menus = [
  { path: '/home', label: '首页看板', icon: DataBoard },
  { path: '/contracts/sale', label: '销售合同', icon: Sell },
  { path: '/contracts/purchase', label: '采购合同', icon: ShoppingCart },
  { path: '/personnel', label: '人员档案', icon: User },
  { path: '/dicts', label: '字典配置', icon: Collection },
  { path: '/settings', label: '系统设置', icon: Setting },
]

const activeMenu = computed(() => (route.path.startsWith('/') ? route.path : '/home'))
const currentTitle = computed(() => (route.meta && route.meta.title ? String(route.meta.title) : ''))
const storageInfo = ledger.storageInfo

const engineTagType = computed(() => (storageInfo.value.writable ? 'success' : 'danger'))

const storageTip = computed(() => {
  const info = storageInfo.value
  if (!info.writable) return '本地服务当前只读：仅可浏览与导出'
  return `本地服务在线（SQLite 事务写入）· 版本 ${info.server?.version || '—'}`
})

/**
 * @param {string} path
 */
function go(path) {
  drawerVisible.value = false
  router.push(path)
}

async function exportNow() {
  const result = await ledger.actions.exportBackup()
  if (result.ok) ElMessage.success(`已导出 ${result.fileName}`)
  else ElMessage.error(result.message || '导出失败')
}

async function signOut() {
  await endSession()
  ElMessage.success('已退出配对')
  router.replace('/pair')
}

watch(
  () => ledger.status.writeError,
  (error, previous) => {
    if (error && error.message && error.message !== previous?.message) {
      ElMessage.error({ message: error.message, duration: 9000, showClose: true })
    }
  },
)

watch(
  () => route.fullPath,
  () => {
    drawerVisible.value = false
  },
)

onMounted(() => {
  void bootstrap()
})

// 配对完成 / 会话恢复后加载台账数据。
watch(
  () => auth.authenticated.value,
  (ok) => {
    if (ok) void bootstrap()
  },
)

async function bootstrap() {
  if (!auth.authenticated.value || ledger.status.ready) return
  const result = await ledger.actions.init()
  if (!result.ok && result.message) {
    ElMessage.error({ message: result.message, duration: 8000, showClose: true })
  }
}
</script>
