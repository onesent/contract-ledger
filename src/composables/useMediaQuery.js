import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 响应式媒体查询（用于窄屏卡片布局）。
 * @param {string} [query]
 * @returns {import('vue').Ref<boolean>}
 */
export function useMediaQuery(query = '(max-width: 1023px)') {
  const matches = ref(typeof window !== 'undefined' ? window.matchMedia(query).matches : false)
  /** @type {MediaQueryList|null} */
  let mql = null
  const handler = (event) => {
    matches.value = event.matches
  }
  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    mql = window.matchMedia(query)
    matches.value = mql.matches
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler)
    else if (typeof mql.addListener === 'function') mql.addListener(handler)
  })
  onBeforeUnmount(() => {
    if (!mql) return
    if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', handler)
    else if (typeof mql.removeListener === 'function') mql.removeListener(handler)
    mql = null
  })
  return matches
}
