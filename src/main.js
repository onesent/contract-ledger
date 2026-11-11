import { createApp } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import router from './router'
import { init } from './data/store'
import './styles/theme.css'
import './styles/layout.css'
import './styles/pages.css'

const app = createApp(App)

// 全局中文：el-config-provider 在 App.vue 中包裹根组件，语言包在此统一提供。
// Element Plus 的 ConfigProvider 同时会把首个配置写入全局，命令式 API（ElMessageBox 等）也使用中文文案。
app.provide('ep-locale', zhCn)

app.use(router)

// 全局错误兜底：捕获后用 ElNotification 展示，不白屏、不只 console.error
app.config.errorHandler = (err, instance, info) => {
  const message = err && err.message ? err.message : String(err)
  void instance
  try {
    ElNotification({
      title: '运行时错误',
      message: `${message}${info ? `（${info}）` : ''}`,
      type: 'error',
      duration: 8000,
    })
  } catch (notifyError) {
    // 极端兜底：连通知都无法渲染时，至少不让页面标题停留在旧状态
    document.title = '合同管理台账 · 发生错误'
    void notifyError
  }
}

init()
  .then((result) => {
    app.mount('#app')
    if (result && result.message) {
      setTimeout(() => {
        ElMessage({
          message: result.message,
          type: 'warning',
          duration: 6000,
          showClose: true,
        })
      }, 400)
    }
  })
  .catch((error) => {
    // init 内部已做三态兜底，这里处理极端异常：仍然挂载应用（只读模式），避免白屏
    try {
      ElNotification({
        title: '存储初始化异常',
        message: error && error.message ? error.message : String(error),
        type: 'error',
        duration: 10000,
      })
    } catch {
      /* ignore */
    }
    app.mount('#app')
  })
