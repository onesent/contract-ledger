import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * 方案 B：源码按模块分文件，构建为单一自包含 index.html。
 * - 全部静态资源内联，dist/ 下只有 index.html
 * - ECharts 按需注册（src/utils/echarts.js），Element Plus 按需自动导入
 * - 不配置 external / manualChunks / rollupOptions.output，避免产生分包
 */
export default defineConfig({
  base: './',
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
    viteSingleFile({
      removeViteModuleLoader: true,
      useRecommendedBuildConfig: true,
    }),
  ],
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 6000,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 8080,
  },
})
