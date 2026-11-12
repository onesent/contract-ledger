/**
 * 浏览器会话认证状态（模块级单例，路由守卫与配对页共用）。
 *
 * 流程：服务启动时终端打印一次性配对码 → 配对页提交 /api/auth/pair →
 * 服务签发 HttpOnly 会话 Cookie + 可读 CSRF Cookie → 后续请求自动带凭证。
 * 401（AUTH_REQUIRED / AUTH_INVALID）由 client.js 回调这里，重置状态并跳转配对页。
 */
import { readonly, ref } from 'vue'
import { pair, getSession, logout, setUnauthorizedHandler } from './client'

const authenticated = ref(false)
const actor = ref('')
const loading = ref(false)
const error = ref('')
const checked = ref(false)

/** 会话失效时由路由跳转配对页（router 注入，避免循环依赖）。 */
let onUnauthorized = () => {}

/** ensureSession 自身发起的 getSession 401 不应触发跳转（守卫已负责重定向）。 */
let checking = false

/**
 * 注入未认证跳转逻辑。
 * @param {(redirect?: string) => void} handler
 */
export function setUnauthorizedRedirect(handler) {
  onUnauthorized = typeof handler === 'function' ? handler : () => {}
}

setUnauthorizedHandler(() => {
  authenticated.value = false
  actor.value = ''
  checked.value = false
  if (!checking) onUnauthorized()
})

/**
 * 确认当前会话：GET /api/auth/session。
 * 已确认过则直接返回缓存状态；未认证（401）不视为异常。
 * @returns {Promise<boolean>} 是否已认证
 */
export async function ensureSession() {
  if (checked.value) return authenticated.value
  loading.value = true
  checking = true
  try {
    const session = await getSession()
    authenticated.value = Boolean(session && session.ok)
    actor.value = session && typeof session.actor === 'string' ? session.actor : 'browser'
    checked.value = authenticated.value
  } catch (err) {
    authenticated.value = false
    actor.value = ''
    checked.value = false
    if (!err.isUnauthorized) error.value = err.message || '会话检查失败'
  } finally {
    checking = false
    loading.value = false
  }
  return authenticated.value
}

/**
 * 提交配对码。
 * @param {string} code 服务终端打印的一次性配对码
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function submitPair(code) {
  const trimmed = String(code || '').trim()
  if (trimmed === '') {
    error.value = '请输入配对码'
    return { ok: false, message: error.value }
  }
  loading.value = true
  error.value = ''
  try {
    const result = await pair(trimmed)
    authenticated.value = Boolean(result && result.ok)
    actor.value = result && typeof result.actor === 'string' ? result.actor : 'browser'
    checked.value = authenticated.value
    return { ok: authenticated.value, message: '' }
  } catch (err) {
    const message =
      err.code === 'RATE_LIMITED'
        ? '配对尝试过于频繁，请等待约 1 分钟后回到终端获取新的配对码。'
        : err.code === 'PAIR_CODE_INVALID'
          ? '配对码无效、已过期或已使用；请回到服务启动终端获取新的配对码。'
          : err.message || '配对失败，请检查本地服务是否已启动。'
    error.value = message
    return { ok: false, message }
  } finally {
    loading.value = false
  }
}

/** 登出：吊销会话并回到未认证状态。 */
export async function signOut() {
  try {
    await logout()
  } finally {
    authenticated.value = false
    actor.value = ''
    checked.value = false
    error.value = ''
  }
}

/** 认证状态只读视图。 */
export const auth = {
  authenticated: readonly(authenticated),
  actor: readonly(actor),
  loading: readonly(loading),
  error: readonly(error),
  checked: readonly(checked),
  /** 供测试重置模块状态。 */
  currentActor: () => actor.value,
}

export { authenticated, actor, loading, error, checked }
export default auth
