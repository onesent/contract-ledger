import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import ContractsView from '../views/ContractsView.vue'
import PersonnelView from '../views/PersonnelView.vue'
import DictsView from '../views/DictsView.vue'
import SettingsView from '../views/SettingsView.vue'
import PairView from '../views/PairView.vue'
import { auth, ensureSession, setUnauthorizedRedirect } from '../api/auth'

/**
 * 路由：保持 hash 模式（刷新 / 前进后退不依赖服务端 rewrite）。
 * 数据面全部走本地服务 API；/pair 之外的页面必须先有会话。
 */
const routes = [
  { path: '/', redirect: '/home' },
  { path: '/pair', name: 'pair', component: PairView, meta: { title: '连接本地服务', public: true } },
  { path: '/home', name: 'home', component: HomeView, meta: { title: '首页' } },
  // 旧入口兼容：/contracts 重定向到销售合同，并透传 query（书签 #/contracts?quick=... 不失效）
  { path: '/contracts', redirect: (to) => ({ path: '/contracts/sale', query: to.query }) },
  {
    path: '/contracts/sale',
    name: 'contracts-sale',
    component: ContractsView,
    meta: { title: '销售合同', direction: 'sale' },
  },
  {
    path: '/contracts/purchase',
    name: 'contracts-purchase',
    component: ContractsView,
    meta: { title: '采购合同', direction: 'purchase' },
  },
  { path: '/personnel', name: 'personnel', component: PersonnelView, meta: { title: '人员档案' } },
  { path: '/dicts', name: 'dicts', component: DictsView, meta: { title: '字典配置' } },
  { path: '/settings', name: 'settings', component: SettingsView, meta: { title: '系统设置' } },
  { path: '/:pathMatch(.*)*', redirect: '/home' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

/** 会话失效（任意请求 401）时跳转配对页，并带上原目标。 */
setUnauthorizedRedirect(() => {
  const current = router.currentRoute.value
  if (current.meta && current.meta.public) return
  void router.replace({ path: '/pair', query: { redirect: current.fullPath } })
})

/** @type {Set<() => string>} */
const unsavedGuards = new Set()

/**
 * 注册「未保存修改」守卫（组件卸载时调用返回的清理函数）。
 * @param {() => string} getMessage 返回非空字符串表示有未保存修改
 * @returns {() => void}
 */
export function registerUnsavedGuard(getMessage) {
  unsavedGuards.add(getMessage)
  return () => unsavedGuards.delete(getMessage)
}

/** @returns {string} */
function collectGuardMessage() {
  for (const guard of unsavedGuards) {
    try {
      const message = guard()
      if (message) return message
    } catch {
      /* 守卫异常不应阻塞路由 */
    }
  }
  return ''
}

router.beforeEach(async (to, from) => {
  // 1) 认证：/pair 公开；其余页面必须先有会话（任意请求 401 会经 auth 回调跳回配对页）。
  if (!(to.meta && to.meta.public)) {
    const ok = await ensureSession()
    if (!ok && !auth.authenticated.value) {
      return { path: '/pair', query: { redirect: to.fullPath } }
    }
  }
  if (to.path === from.path) return true

  // 2) 未保存修改守卫。
  const message = collectGuardMessage()
  if (!message) return true
  try {
    await ElMessageBox.confirm(message, '有未保存修改', {
      confirmButtonText: '放弃修改并离开',
      cancelButtonText: '留在当前页',
      type: 'warning',
      distinguishCancelAndClose: true,
      // hash 路由下历史前进/后退会触发 hashchange；保持确认框不被 EP 默认行为关闭
      closeOnHashChange: false,
    })
    return true
  } catch {
    // 用户选择「留在当前页」：如果是浏览器前进/后退触发的导航，URL 已被浏览器改掉，
    // 这里同步把地址栏恢复为当前路由，避免地址与视图不一致（replaceState 不会触发守卫）。
    try {
      const fromHash = `#${from.fullPath}`
      if (window.location.hash !== fromHash && decodeURI(window.location.hash) !== decodeURI(fromHash)) {
        window.history.replaceState(window.history.state, '', fromHash)
      }
    } catch {
      /* ignore */
    }
    return false
  }
})

router.afterEach((to) => {
  const title = to.meta && to.meta.title ? String(to.meta.title) : '台账'
  document.title = `${title} · 合同管理台账工作台`
})

export default router
