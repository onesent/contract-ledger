/**
 * 文档漂移检查：启动器命令面（launcher/spec.json）↔ 用户可见文档。
 *
 * 背景：入口子命令被删除后，分发包 README 与 docs 仍在教用户执行它们，
 * 这类「功能变更漂移」靠人工核对必然漏。这里把它变成测试：
 *
 *   1. launcher/spec.json 由 scripts/gen-launcher-spec.mjs 从 launcher/spec.go 生成，
 *      Go 侧 spec_test.go 保证快照与代码一致（改代码没重新生成 → go test 失败）。
 *   2. 本测试保证文档与快照一致：
 *      · 文档里出现的 `ledger.exe <子命令>` 必须是已声明的子命令；
 *      · 文档里出现的启动器选项必须是已声明的选项；
 *      · 每个可见子命令必须至少在一份文档里被写到（避免「加了命令没人写文档」）。
 *
 * 只检查启动器自身命令面；`ledger.exe cli ...` 之后的 CLI 参数由
 * packages/cli 的 discovery 测试守护（schema/commands.json 与注册表一致）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 需要与启动器命令面保持一致的文档（分发包内 README 模板 + 用户文档）。 */
const DOC_FILES = [
  'docs/distribution-readme.txt',
  'docs/distribution.md',
  'README.md',
]

/** 用户入口文档：每个可见子命令都必须在这里出现。 */
const PRIMARY_DOC = 'docs/distribution-readme.txt'

/** 读取启动器命令面快照。 */
function loadSpec() {
  return JSON.parse(readFileSync(path.join(ROOT, 'launcher/spec.json'), 'utf8'))
}

/**
 * 抽取文档里引用到的启动器子命令。
 * 只认小写 `ledger.exe <word>` 形态；`ledger.exe --flag`、`ledger.exe [start]`、
 * `ledger.exe SHA256`（certutil 参数）等会被跳过。
 * @param {string} text 文档内容
 * @returns {Set<string>} 子命令名集合
 */
function referencedCommands(text) {
  const found = new Set()
  for (const match of text.matchAll(/ledger\.exe\s+([a-z][a-z-]*)/g)) {
    found.add(match[1])
  }
  return found
}

/**
 * 抽取文档里紧跟在 `ledger.exe` 后面的启动器选项。
 * 只认 `ledger.exe --flag` 这一形态：其余 `--json`、`--sql` 等属于被转发的
 * CLI（由 packages/cli 的 discovery 测试守护），不在这里判断。
 * @param {string} text 文档内容
 * @returns {Set<string>} 选项名集合
 */
function referencedLauncherOptions(text) {
  const found = new Set()
  for (const match of text.matchAll(/ledger\.exe\s+(--[a-z][a-z-]*)/g)) {
    found.add(match[1])
  }
  return found
}

describe('启动器文档与命令面一致', () => {
  const spec = loadSpec()
  const commands = new Set(spec.commands.map((command) => command.name))
  const visible = spec.commands.filter((command) => !command.hidden)
  const options = new Set(spec.options.map((option) => option.flag))

  it('spec.json 至少声明了 start/stop/status/cli/server/version/help', () => {
    for (const name of ['start', 'stop', 'status', 'cli', 'server', 'version', 'help']) {
      expect(commands.has(name), `spec.json 缺少子命令 ${name}`).toBe(true)
    }
  })

  it.each(DOC_FILES)('%s 只引用已声明的子命令', (file) => {
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    const unknown = [...referencedCommands(text)].filter((name) => !commands.has(name))
    expect(unknown, `${file} 引用了未声明的子命令：${unknown.join(', ')}`).toEqual([])
  })

  it.each(DOC_FILES)('%s 只引用已声明的启动器选项', (file) => {
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    const unknown = [...referencedLauncherOptions(text)].filter((flag) => !options.has(flag))
    expect(unknown, `${file} 引用了未声明的启动器选项：${unknown.join(', ')}`).toEqual([])
  })

  it('每个可见子命令都写进了用户入口文档', () => {
    const text = readFileSync(path.join(ROOT, PRIMARY_DOC), 'utf8')
    const documented = referencedCommands(text)
    const missing = visible.map((command) => command.name).filter((name) => !documented.has(name))
    expect(missing, `${PRIMARY_DOC} 未写到：${missing.join(', ')}`).toEqual([])
  })

  it('每个启动器选项都写进了用户入口文档', () => {
    const text = readFileSync(path.join(ROOT, PRIMARY_DOC), 'utf8')
    const missing = spec.options
      .map((option) => option.flag)
      .filter((flag) => !text.includes(flag))
    expect(missing, `${PRIMARY_DOC} 未写到选项：${missing.join(', ')}`).toEqual([])
  })

  it('每个可见子命令的用法都出现在用户入口文档里', () => {
    const text = readFileSync(path.join(ROOT, PRIMARY_DOC), 'utf8')
    const missing = visible
      .map((command) => command.name)
      .filter((name) => !new RegExp(`ledger\\.exe[^\\n]*\\b${name}\\b`).test(text))
    expect(missing, `${PRIMARY_DOC} 缺少用法行：${missing.join(', ')}`).toEqual([])
  })

  it('退出码表在用户入口文档与分发文档中一致', () => {
    const readme = readFileSync(path.join(ROOT, 'docs/distribution.md'), 'utf8')
    for (const { code } of spec.exitCodes) {
      expect(readme, `docs/distribution.md 未提到退出码 ${code}`).toMatch(
        new RegExp(`(^|[^0-9])${code}([^0-9]|$)`),
      )
    }
  })
})
