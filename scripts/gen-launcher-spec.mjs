#!/usr/bin/env node
/**
 * 生成 launcher/spec.json —— 启动器命令面的机器可读快照。
 *
 * 为什么需要它：`ledger.exe help`、分发包 README、docs/*.md 都在描述同一批
 * 子命令与选项。三者靠人同步必然漂移（曾经出现「README 教用户执行已删除的
 * upgrade 子命令」）。这里把 Go 侧声明的命令面导出成 JSON 提交在仓库里：
 *
 *   launcher/spec.go  ──go test（spec_test.go）──▶ launcher/spec.json
 *   launcher/spec.json ──vitest（docs-drift.test.mjs）──▶ README / docs
 *
 * 因此：改命令面 → 跑本脚本 → 跑测试；任何一环没跟上都会失败。
 *
 * 用法：npm run spec:launcher
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = path.join(ROOT, 'launcher')

const result = spawnSync('go', ['run', '.', 'spec'], {
  cwd: LAUNCHER,
  encoding: 'utf8',
  shell: false,
})

if (result.error) {
  process.stderr.write(`无法执行 go run：${result.error.message}\n`)
  process.exit(1)
}
if (result.status !== 0) {
  process.stderr.write(`生成失败（退出码 ${result.status}）：\n${result.stderr}\n`)
  process.exit(result.status ?? 1)
}

const payload = JSON.parse(result.stdout)
const target = path.join(LAUNCHER, 'spec.json')
writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`)

const visible = payload.commands.filter((command) => !command.hidden)
process.stdout.write(
  `已写入 ${path.relative(ROOT, target)}：${visible.length} 个子命令、${payload.options.length} 个选项、${payload.exitCodes.length} 个退出码\n`,
)
