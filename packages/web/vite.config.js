import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

/** 本地台账服务地址（与 packages/server 默认端口一致）。 */
const API_TARGET = 'http://127.0.0.1:4517'

/**
 * 前端构建：标准多文件产物（dist/ 含 assets/），数据全部走本地服务 API。
 * - Element Plus 按需自动导入（组件 + 命令式 API 样式）
 * - ECharts 按需注册（src/utils/echarts.js），不整包引入
 * - dev 代理 /api → 127.0.0.1:4517；服务对 Cookie 写请求校验精确 Origin，
 *   changeOrigin 只改写 Host，因此必须同时把出站 Origin 头改写为服务自身的 origin。
 */
export default defineConfig({
  base: '/',
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: false,
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: false,
    }),
  ],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 6000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', API_TARGET)
          })
        },
      },
    },
  },
  preview: {
    port: 8080,
  },
})
