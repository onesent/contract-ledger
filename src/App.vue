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
            <el-tag
              v-if="storageInfo.portable"
              class="portable-tag"
              type="warning"
              effect="dark"
              size="small"
            >
              便携模式
            </el-tag>
            <el-tag v-if="!storageInfo.writable" type="danger" effect="plain" size="small">只读</el-tag>
          </div>
        </el-header>

        <el-main class="app-main">
          <!-- 便携模式（file://）醒目横幅 -->
          <el-alert
            v-if="storageInfo.portable"
            class="portable-alert"
            type="warning"
            show-icon
            :closable="false"
            title="当前为便携模式（file://）"
            style="margin-bottom: 14px"
          >
            浏览器对本地文件的存储行为未定义，数据与本文件路径绑定；移动、重命名或换浏览器打开都可能导致数据看似丢失。
            请定期导出备份，正式使用建议用 localhost 方式打开。
          </el-alert>

          <!-- 存储降级提示 -->
          <el-alert
            v-if="storageInfo.engine === 'localstorage'"
            type="warning"
            show-icon
            :closable="false"
            title="已降级为 localStorage"
            style="margin-bottom: 14px"
          >
            IndexedDB 不可用（{{ storageInfo.idbError || '原因未知' }}），当前使用 localStorage，仅适合小规模数据，
            写满时会明确失败并停止录入。建议立即导出备份，并在支持的浏览器中用 localhost 方式打开。
          </el-alert>

          <!-- 只读模式横幅 -->
          <el-alert
            v-if="!storageInfo.writable"
            type="error"
            show-icon
            :closable="false"
            title="当前为只读模式：写入已停止"
            style="margin-bottom: 14px"
          >
            {{ storageInfo.writeError?.message || storageInfo.lastError || '浏览器禁用了本地存储（可能是隐私模式或站点数据被清除）。' }}
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
            数据仅保存在本机浏览器 · 导出 JSON 才是真正的存档 · 应用不上传任何服务器
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

const engineTagType = computed(() => {
  if (!storageInfo.value.writable) return 'danger'
  if (storageInfo.value.engine === 'indexeddb') return 'success'
  return 'warning'
})

const storageTip = computed(() => {
  const info = storageInfo.value
  if (info.engine === 'indexeddb') return 'IndexedDB 主引擎：事务写入，刷新与重启浏览器后数据保留'
  if (info.engine === 'localstorage') return 'localStorage 降级：仅适合小规模数据，写满时会停止录入'
  return '内存只读模式：仅可浏览与导出'
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
  if (result.ok) {
    if (result.warning) ElMessage.warning(result.warning)
    else ElMessage.success(`已导出 ${result.fileName}`)
  } else {
    ElMessage.error(result.message || '导出失败')
  }
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

onMounted(async () => {
  // 首次启动：空库时询问是否载入演示数据（可一键清空，不是不可移除的硬编码数据源）
  if (ledger.data.contracts.length === 0 && !ledger.data.meta.seeded) {
    try {
      await ElMessageBox.confirm(
        '检测到空数据库。是否载入 15 条覆盖常见场景的演示数据（执行中 / 已完结 / 已终止 / 逾期 / 零金额 / 跨年度等）？演示数据可随时在「系统设置 → 数据管理」中一键清空。',
        '首次使用',
        {
          confirmButtonText: '载入演示数据',
          cancelButtonText: '从空白开始',
          type: 'info',
          distinguishCancelAndClose: true,
        },
      )
      const result = await ledger.actions.loadDemoData()
      if (result.ok) {
        ElMessage.success(
          `已载入演示数据：${result.counts.contracts} 份合同 / ${result.counts.payments} 条收款 / ${result.counts.personnel} 名人员`,
        )
      } else {
        ElMessage.error(result.message || '载入演示数据失败')
      }
    } catch {
      await ledger.actions.markSeeded()
      ElMessage.info('已跳过着，可随时在「系统设置 → 数据管理」中载入演示数据')
    }
  }
})
</script>
