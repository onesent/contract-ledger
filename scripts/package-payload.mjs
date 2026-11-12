/**
 * 组装便携载荷：运行时 + 各包 dist + 迁移 + 前端产物 + 白名单依赖。
 *
 * 用法：node scripts/package-payload.mjs [--node-exe <path>] [--version <v>] [--out <dir>]
 *
 * 产出：<out>/.staging/ledger-payload-<version>-win-x64.zip 与其 sha256。
 * 依赖：npm（安装白名单依赖）、tar.exe（写 zip，Windows 10 1803+ 自带）。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { resolveNodeExe } from './fetch-node.mjs'
import { buildTimestamp } from './build-time.mjs'
import { writeZip } from './zip.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
/** 必须用系统自带 bsdtar：PATH 上的 tar 可能是 MSYS/GNU tar，不支持写 zip。 */
const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
const PLATFORM = 'win32'
const ARCH = 'x64'
const PREBUILD = 'win32-x64.node'
/** 载荷内需要 dist + package.json 的工作区包。 */
const APP_PACKAGES = ['core', 'storage-sqlite', 'server', 'cli']

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
  process.stderr.write(`打包失败：${message}\n`)
  process.exit(1)
}

/**
 * 读取 JSON 文件。
 * @param {string} file 路径
 * @returns {any}
 */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
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
 * 收集运行时白名单依赖（版本从各包 package.json 精确复制，不写范围符）。
 * @returns {Record<string, string>}
 */
function runtimeDependencies() {
  /** @type {Record<string, string>} */
  const deps = {}
  for (const name of APP_PACKAGES) {
    const pkg = readJson(path.join(ROOT, 'packages', name, 'package.json'))
    for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
      if (dep.startsWith('@ledger/')) continue
      if (!/^\d+\.\d+\.\d+/.test(String(range))) {
        fail(`依赖 ${dep} 的版本 ${range} 不是精确版本，无法保证可复现。`)
      }
      deps[dep] = String(range)
    }
  }
  return deps
}

/**
 * 递归取目录内文件的最新修改时间。
 * @param {string} dir 目录
 * @returns {number} 毫秒时间戳；空目录返回 0
 */
function newestMtime(dir) {
  let newest = 0
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        newest = Math.max(newest, statSync(full).mtimeMs)
      }
    }
  }
  walk(dir)
  return newest
}

/**
 * 找出源码比产物新的包（避免打包出陈旧 dist，例如改完 src 忘跑 tsc -b）。
 * @returns {string[]} 过期的包路径
 */
function staleArtifacts() {
  const stale = []
  for (const name of APP_PACKAGES) {
    const src = path.join(ROOT, 'packages', name, 'src')
    const dist = path.join(ROOT, 'packages', name, 'dist')
    if (existsSync(src) && newestMtime(src) > newestMtime(dist)) stale.push(`packages/${name}`)
  }
  const webSrc = path.join(ROOT, 'packages', 'web', 'src')
  const webDist = path.join(ROOT, 'packages', 'web', 'dist')
  if (existsSync(webSrc) && newestMtime(webSrc) > newestMtime(webDist)) stale.push('packages/web')
  return stale
}

/**
 * 前置校验：构建产物与迁移目录存在，且产物不比源码旧。
 */
function preflight() {
  const missing = []
  for (const name of APP_PACKAGES) {
    if (!existsSync(path.join(ROOT, 'packages', name, 'dist'))) missing.push(`packages/${name}/dist`)
  }
  if (!existsSync(path.join(ROOT, 'packages', 'web', 'dist'))) missing.push('packages/web/dist')
  if (!existsSync(path.join(ROOT, 'packages', 'storage-sqlite', 'migrations'))) {
    missing.push('packages/storage-sqlite/migrations')
  }
  if (missing.length > 0) {
    fail(`缺少构建产物：${missing.join('、')}。请先运行 npm run typecheck && npm run build。`)
  }
  const stale = staleArtifacts()
  if (stale.length > 0) {
    process.stderr.write(
      `提示：${stale.join('、')} 的源码比产物新，已按现有 dist 打包；如内容有改动请先运行 npm run typecheck。
`,
    )
  }
}

/**
 * 安装白名单依赖（必须 --ignore-scripts：better-sqlite3 的 node-gyp rebuild 在无 VS 时会失败）。
 * @param {string} work 载荷根目录
 * @param {Record<string, string>} deps 依赖表
 */
function installDependencies(work, deps) {
  writeFileSync(
    path.join(work, 'package.json'),
    `${JSON.stringify({ name: 'ledger-payload', private: true, type: 'module', dependencies: deps }, null, 2)}\n`,
  )
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(
    npm,
    ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (result.status !== 0) fail(`npm install 退出码 ${result.status}（白名单依赖安装失败）。`)
}

/**
 * 把工作区包复制为真实目录（消解 workspaces 符号链接）。
 * @param {string} work 载荷根目录
 */
function copyWorkspacePackages(work) {
  for (const name of APP_PACKAGES) {
    const src = path.join(ROOT, 'packages', name)
    const dest = path.join(work, 'node_modules', '@ledger', name)
    rmSync(dest, { recursive: true, force: true })
    cpSync(path.join(src, 'dist'), path.join(dest, 'dist'), { recursive: true, dereference: true })
    cpSync(path.join(src, 'package.json'), path.join(dest, 'package.json'))
    if (lstatSync(dest).isSymbolicLink()) fail(`node_modules/@ledger/${name} 仍是符号链接。`)
    if (name === 'storage-sqlite') {
      // defaultMigrationsDir() 基于 import.meta.url 解析到包内 migrations/
      cpSync(path.join(src, 'migrations'), path.join(dest, 'migrations'), { recursive: true })
    }
  }
}

/**
 * 只保留目标平台的 better-sqlite3 预编译二进制。
 * @param {string} work 载荷根目录
 * @returns {number} 保留的文件数
 */
function prunePrebuilds(work) {
  let kept = 0
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'prebuilds') {
          for (const file of readdirSync(full)) {
            if (file === PREBUILD) {
              kept += 1
            } else {
              rmSync(path.join(full, file), { force: true })
            }
          }
          if (kept === 0) fail(`prebuilds 中缺少 ${PREBUILD}，无法在本平台加载 better-sqlite3。`)
        } else if (entry.name !== 'node_modules') {
          walk(full)
        } else {
          walk(full)
        }
      }
    }
  }
  walk(path.join(work, 'node_modules'))
  return kept
}

/**
 * 主流程。
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const version = args.version ?? readJson(path.join(ROOT, 'package.json')).version
  // 产物目录（不入库、不直接发布）：可运行包目录 + 载荷归档，供 build-launcher 生成分发包。
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'build'))
  const work = path.join(outDir, 'payload')
  const zipName = `ledger-payload-${version}-${PLATFORM}-${ARCH}.zip`
  const zipPath = path.join(outDir, zipName)

  preflight()
  const nodeSource = await resolveNodeExe({ nodeExe: args['node-exe'] })
  const deps = runtimeDependencies()

  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  writeFileSync(path.join(work, 'node.exe'), readFileSync(nodeSource.exePath))

  installDependencies(work, deps)
  copyWorkspacePackages(work)
  const kept = prunePrebuilds(work)

  cpSync(path.join(ROOT, 'packages', 'web', 'dist'), path.join(work, 'packages', 'web', 'dist'), {
    recursive: true,
  })

  const backupScript = path.join(ROOT, 'scripts', 'backup-data.mjs')
  if (existsSync(backupScript)) {
    mkdirSync(path.join(work, 'scripts'), { recursive: true })
    cpSync(backupScript, path.join(work, 'scripts', 'backup-data.mjs'))
  }

  const gitSha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  const repoPkg = readJson(path.join(ROOT, 'package.json'))
  const enginesRange = typeof repoPkg.engines?.node === 'string' ? repoPkg.engines.node : '>=24.0.0'
  const builtAtDate = buildTimestamp()
  const builtAt = builtAtDate.toISOString()
  const common = {
    version,
    gitSha: (gitSha.stdout ?? '').trim() || 'unknown',
    builtAt,
    node: enginesRange,
    schema: 1,
  }
  // 服务端从这里读取版本与 Node 门槛（packages/server/src/build-info.ts 的第二个来源）。
  writeFileSync(
    path.join(work, 'node_modules', '@ledger', 'server', 'dist', 'build-info.json'),
    `${JSON.stringify(common, null, 2)}\n`,
  )
  // VERSION 只放版本号（启动器据此判版本，必须是纯文本），其余元数据放 build-info.json。
  writeFileSync(path.join(work, 'VERSION'), `${version}\n`)
  writeFileSync(
    path.join(work, 'build-info.json'),
    `${JSON.stringify(
      { ...common, platform: PLATFORM, arch: ARCH, runtime: process.version },
      null,
      2,
    )}\n`,
  )

  rmSync(zipPath, { force: true })
  const zipInfo = writeZip({ rootDir: work, outFile: zipPath, mtime: builtAtDate })

  const sha = sha256File(zipPath)
  writeFileSync(`${zipPath}.sha256`, `${sha}  ${zipName}\n`)

  const sizeMb = (statSync(zipPath).size / 1024 / 1024).toFixed(1)
  process.stdout.write(
    `产物（可运行包）：${work}\n` +
      `  版本 ${version} / ${PLATFORM}-${ARCH} / prebuilds 保留 ${kept} 个\n` +
      `载荷归档：${zipPath}\n` +
      `  ${sizeMb} MB / sha256 ${sha}\n`,
  )
}

main().catch((error) => {
  process.stderr.write(`打包失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
