#!/usr/bin/env node
/**
 * ledger-server 可执行入口：调用 main 并在启动失败时以非零退出码结束。
 */
import { main } from './main.js'

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`ledger-server: 启动失败：${message}\n`)
  process.exitCode = 1
})
