/**
 * 构建启动器并把「可运行树」打成分发包 zip。
 *
 * 用法：node scripts/build-launcher.mjs [--version <v>] [--build <dir>] [--out <dir>]
 *
 * 分发包结构（解压即得一个自包含目录，`ledger.exe` 只是入口）：
 *   ledger-<version>-win-x64/
 *     ledger.exe  VERSION  node.exe  node_modules/  packages/web/dist/
 *     README.txt  SHA256SUMS
 *
 * 产出：
 * - `build/dist/ledger-<version>-win-x64/`：可运行目录（本地排障直接跑）
 * - `release/ledger-<version>-win-x64.zip`：分发包
 * - `release/ledger-<version>-win-x64.zip.sha256`、`release/SHA256SUMS`
 *
 * 前置：先运行 scripts/package-payload.mjs 生成 `build/payload/` 与载荷归档。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { buildTimestamp } from './build-time.mjs'
import { writeZip } from './zip.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const PLATFORM = 'win32'
const ARCH = 'x64'
const EXE_NAME = 'ledger.exe'

/**
 * 读取命令行选项。
 * @param {string[]} argv 参数
 * @returns {Record<string, string | undefined>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | undefined>} */
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      out[key.slice(2)] = 'true'
    } else {
      out[key.slice(2)] = value
      i += 1
    }
  }
  return out
}

/**
 * 以失败语义输出中文错误并退出。
 * @param {string} message 错误说明
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`构建分发包失败：${message}\n`)
  process.exit(1)
}

/**
 * 计算文件 SHA-256。
 * @param {string} file 路径
 * @returns {string}
 */
function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * 生成分发包内的使用说明（静态文本，不含时间戳，保证 zip 可复现）。
 * @param {string} version 版本号
 * @returns {string}
 */
/**
 * 读取分发包 README 模板并替换版本占位符。
 * 模板是用户可见文档的唯一来源（docs/distribution-readme.txt），
 * 其内容与启动器命令面的一致性由 scripts/docs-drift.test.mjs 守护。
 * @param {string} version 版本号
 * @returns {string} README.txt 内容
 */
function usageText(version) {
  const template = readFileSync(path.join(ROOT, 'docs/distribution-readme.txt'), 'utf8')
  return template.replaceAll('{{version}}', version)
}

/**
 * 递归列出目录内所有文件的相对路径（POSIX 分隔符），排序保证可复现。
 * @param {string} rootDir 根目录
 * @returns {string[]}
 */
function listFiles(rootDir) {
  /** @type {string[]} */
  const out = []
  /** @param {string} dir @param {string} prefix */
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
      else out.push(rel)
    }
  }
  walk(rootDir, '')
  return out
}

const args = parseArgs(process.argv.slice(2))
const version = args.version ?? JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const buildDir = path.resolve(args.build ?? path.join(ROOT, 'build'))
const outDir = path.resolve(args.out ?? path.join(ROOT, 'release'))
const payloadDir = path.join(buildDir, 'payload')
if (!existsSync(path.join(payloadDir, 'VERSION'))) {
  fail(`可运行包不存在：${payloadDir}。请先运行 node scripts/package-payload.mjs 生成产物。`)
}

// 1. 构建入口 exe（控制台子系统；不再嵌入载荷，运行时就是同目录的这些文件）。
const launcherDir = path.join(buildDir, 'launcher')
mkdirSync(launcherDir, { recursive: true })
const exePath = path.join(launcherDir, EXE_NAME)
const go = spawnSync(
  'go',
  [
    'build',
    '-trimpath',
    '-ldflags',
    // 控制台子系统：解压后即可在任意终端（cmd / PowerShell / Git Bash）直接跑，输出不会被丢弃。
    // 不用 -H windowsgui：GUI 子系统在 mintty 等纯 pty 终端下拿不到 stdout 句柄，所有命令都会静默无输出。
    `-s -w -X main.version=${version}`,
    '-o',
    exePath,
    '.',
  ],
  { cwd: path.join(ROOT, 'launcher'), stdio: 'inherit' },
)
if (go.status !== 0) fail(`go build 退出码 ${go.status}。`)

// 2. 组装可运行目录：载荷（node.exe / node_modules / packages / VERSION）+ 入口 exe + 说明 + 校验。
const distName = `ledger-${version}-win-x64`
const distRoot = path.join(buildDir, 'dist', distName)
rmSync(distRoot, { recursive: true, force: true })
mkdirSync(path.dirname(distRoot), { recursive: true })
cpSync(payloadDir, distRoot, { recursive: true })
cpSync(exePath, path.join(distRoot, EXE_NAME))
writeFileSync(path.join(distRoot, 'README.txt'), usageText(version))

// 分发包内的校验清单：只列关键文件，升级时据此自检（全量哈希会让解压后校验很慢）。
const innerChecks = ['ledger.exe', 'node.exe', 'VERSION']
writeFileSync(
  path.join(distRoot, 'SHA256SUMS'),
  innerChecks.map((name) => `${sha256File(path.join(distRoot, name))}  ${name}`).join('\n') + '\n',
)

// 3. 打包：zip 内套一层版本目录，解压即得自包含文件夹。内容多为文本/JS，用 deflate 压缩。
const zipName = `${distName}.zip`
const zipPath = path.join(outDir, zipName)
mkdirSync(outDir, { recursive: true })
const zipInfo = writeZip({
  rootDir: path.join(buildDir, 'dist'),
  entries: [distName],
  outFile: zipPath,
  mtime: buildTimestamp(),
  level: 6,
})
const zipSha = sha256File(zipPath)
writeFileSync(`${zipPath}.sha256`, `${zipSha}  ${zipName}\n`)
writeFileSync(path.join(outDir, 'SHA256SUMS'), `${zipSha}  ${zipName}\n`)

const exeMb = (statSync(exePath).size / 1024 / 1024).toFixed(1)
const zipMb = (statSync(zipPath).size / 1024 / 1024).toFixed(1)
const fileCount = listFiles(distRoot).length
process.stdout.write(
  `入口 exe：${exePath}\n` +
    `  版本 ${version} / ${exeMb} MB（控制台子系统，文件名不带版本号）\n` +
    `可运行目录：${distRoot}\n` +
    `  ${fileCount} 个文件（node.exe / node_modules / packages\\web\\dist / VERSION）\n` +
    `分发包：${zipPath}\n` +
    `  ${zipMb} MB / 顶层目录 ${distName}/\n` +
    `  zip sha256 ${zipSha}\n` +
    `  校验清单：${path.join(outDir, 'SHA256SUMS')}\n`,
)
