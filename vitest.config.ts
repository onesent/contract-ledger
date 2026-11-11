import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Vitest 根配置：源码测试走 @ledger/* 别名直连各包 src，
 * 避免测试依赖先执行 tsc 构建产物。
 */
const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
  resolve: {
    alias: {
      '@ledger/core': fromRoot('./packages/core/src/index.ts'),
      '@ledger/storage-sqlite': fromRoot('./packages/storage-sqlite/src/index.ts'),
      '@ledger/cli': fromRoot('./packages/cli/src/index.ts'),
      '@ledger/server': fromRoot('./packages/server/src/index.ts'),
      '@ledger/mcp': fromRoot('./packages/mcp/src/index.ts'),
    },
  },
})
