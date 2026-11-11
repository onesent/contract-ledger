import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import ContractsView from '../views/ContractsView.vue'
import PersonnelView from '../views/PersonnelView.vue'
import DictsView from '../views/DictsView.vue'
import SettingsView from '../views/SettingsView.vue'

/**
 * 路由：一律使用 hash 模式，file:// 下刷新、前进后退均可用。
 * 路由组件静态引入（不分包），确保单文件产物自包含。
 */
const routes = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'home', component: HomeView, meta: { title: '首页' } },
  { path: '/contracts', name: 'contracts', component: ContractsView, meta: { title: '合同管理' } },
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
  if (to.path === from.path) return true
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
