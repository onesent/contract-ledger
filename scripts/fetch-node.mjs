/**
 * 获取载荷内要打包的 node.exe。
 *
 * 解析顺序（前者优先）：
 * 1. `--node-exe <path>` 或环境变量 `LEDGER_NODE_EXE`：直取本地文件；
 * 2. 缓存 `build/.cache/node-<version>-<platform>-<arch>.zip`；
 * 3. 从 nodejs.org 官方分发下载，并用官方 `SHASUMS256.txt` 校验 SHA-256。
 *
 * 客户机不需要任何工具：这里只决定构建期把哪个 node.exe 放进载荷。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PLATFORM = 'win32'
const DEFAULT_ARCH = 'x64'
const DOWNLOAD_BASE = 'https://nodejs.org/dist'

/**
 * 把 process.platform 映射为官方分发使用的平台名（win32 → win）。
 * @param {string} platform 平台名
 * @returns {string}
 */
export function distPlatformName(platform) {
  if (platform === 'win32') return 'win'
  return platform
}

/**
 * 计算文件 SHA-256。
 * @param {string} file 路径
 * @returns {string}
 */
export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * 从 SHASUMS256.txt 中取出指定文件的哈希。
 * @param {string} text 官方校验文件内容
 * @param {string} fileName 归档文件名（如 node-v24.9.0-win-x64.zip）
 * @returns {string | null}
 */
export function parseShasums(text, fileName) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/)
    if (match !== null && match[2] === fileName) return match[1].toLowerCase()
  }
  return null
}

/**
 * 校验文件哈希，不匹配时抛出中文错误。
 * @param {string} file 文件路径
 * @param {string} expected 期望的 SHA-256
 * @param {string} label 用于报错的来源说明
 */
export function verifyHash(file, expected, label) {
  const actual = sha256File(file)
  if (actual !== expected.toLowerCase()) {
    throw new Error(
      `${label} 校验失败：期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…。请重新下载。`,
    )
  }
}

/**
 * 判断缓存归档是否存在且非空。
 * @param {string} file 缓存归档路径
 * @returns {boolean}
 */
export function isUsableCache(file) {
  return existsSync(file) && statSync(file).size > 0
}

/**
 * 用系统自带 bsdtar 从 zip 中取出 node.exe。
 * @param {string} archive zip 路径
 * @param {string} target 目标 node.exe 路径
 * @param {string} [tarPath] tar.exe 路径
 */
export function extractNodeExe(archive, target, tarPath = defaultTarPath()) {
  if (!existsSync(tarPath)) {
    throw new Error(`找不到系统自带 tar.exe：${tarPath}（需要 Windows 10 1803+）。`)
  }
  // 官方 zip 内是 node-<ver>-<plat>-<arch>/node.exe，用 --strip-components 去掉目录层。
  const member = `${path.basename(archive, '.zip')}/node.exe`
  const result = spawnSync(
    tarPath,
    ['-x', '-f', archive, '-C', path.dirname(target), '--strip-components', '1', member],
    { stdio: 'inherit' },
  )
  if (result.status !== 0 || !existsSync(target)) {
    throw new Error(`从 ${path.basename(archive)} 解出 node.exe 失败（tar 退出码 ${result.status}）。`)
  }
}

/**
 * 系统自带 tar.exe 的路径（PATH 上的 tar 可能是 MSYS/GNU tar）。
 * @returns {string}
 */
export function defaultTarPath() {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

/**
 * 解析 node.exe 来源。
 * @param {object} options 选项
 * @param {string} [options.nodeExe] 显式指定的 node.exe
 * @param {string} [options.cacheDir] 缓存目录
 * @param {string} [options.platform] 目标平台
 * @param {string} [options.arch] 目标架构
 * @param {string} [options.nodeVersion] 目标 Node 版本（默认当前运行时）
 * @param {typeof fetch} [options.fetchImpl] 注入的 fetch（测试用）
 * @param {(message: string) => void} [options.log] 日志输出
 * @returns {Promise<{exePath: string, source: 'explicit' | 'cache' | 'download', archive?: string}>}
 */
export async function resolveNodeExe(options = {}) {
  const platform = options.platform ?? DEFAULT_PLATFORM
  const arch = options.arch ?? DEFAULT_ARCH
  const version = options.nodeVersion ?? process.version
  const cacheDir = path.resolve(options.cacheDir ?? path.join(ROOT, 'build', '.cache'))
  const log = options.log ?? ((message) => process.stdout.write(`${message}\n`))
  const explicit = options.nodeExe ?? process.env.LEDGER_NODE_EXE

  if (explicit !== undefined && explicit !== '') {
    const resolved = path.resolve(explicit)
    if (!existsSync(resolved)) {
      throw new Error(`--node-exe 指向的文件不存在：${resolved}`)
    }
    return { exePath: resolved, source: 'explicit' }
  }

  const archiveName = `node-${version}-${distPlatformName(platform)}-${arch}.zip`
  const archivePath = path.join(cacheDir, archiveName)
  if (isUsableCache(archivePath)) {
    log(`使用缓存的 Node 归档：${archivePath}`)
    return { exePath: extractCached(archivePath, cacheDir, log), source: 'cache', archive: archivePath }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  mkdirSync(cacheDir, { recursive: true })
  const shasumsUrl = `${DOWNLOAD_BASE}/${version}/SHASUMS256.txt`
  const archiveUrl = `${DOWNLOAD_BASE}/${version}/${archiveName}`
  log(`下载 Node 运行时：${archiveUrl}`)

  const shasumsResponse = await fetchImpl(shasumsUrl)
  if (!shasumsResponse.ok) {
    throw new Error(
      `无法获取官方校验文件（HTTP ${shasumsResponse.status}）：${shasumsUrl}。` +
        '离线构建请用 --node-exe 指向本地 node.exe，或预置缓存归档。',
    )
  }
  const expected = parseShasums(await shasumsResponse.text(), archiveName)
  if (expected === null) {
    throw new Error(`官方校验文件中没有 ${archiveName} 的条目：${shasumsUrl}`)
  }

  const archiveResponse = await fetchImpl(archiveUrl)
  if (!archiveResponse.ok) {
    throw new Error(`下载 ${archiveName} 失败：HTTP ${archiveResponse.status}`)
  }
  const bytes = Buffer.from(await archiveResponse.arrayBuffer())
  const tempArchive = `${archivePath}.partial`
  writeFileSync(tempArchive, bytes)
  verifyHash(tempArchive, expected, `Node 归档 ${archiveName}`)
  renameSync(tempArchive, archivePath)
  log(`已校验并缓存：${archivePath}`)

  return { exePath: extractCached(archivePath, cacheDir, log), source: 'download', archive: archivePath }
}

/**
 * 从缓存归档解出 node.exe。
 * @param {string} archivePath 归档路径
 * @param {string} cacheDir 缓存目录
 * @param {(message: string) => void} log 日志输出
 * @returns {string} node.exe 路径
 */
function extractCached(archivePath, cacheDir, log) {
  const target = path.join(cacheDir, path.basename(archivePath).replace(/\.zip$/, ''), 'node.exe')
  if (existsSync(target)) {
    log(`复用已解出的 node.exe：${target}`)
    return target
  }
  mkdirSync(path.dirname(target), { recursive: true })
  extractNodeExe(archivePath, target)
  return target
}

/**
 * 清理缓存（测试与手动维护用）。
 * @param {string} cacheDir 缓存目录
 */
export function clearCache(cacheDir) {
  rmSync(cacheDir, { recursive: true, force: true })
}

/**
 * 命令行入口。
 */
async function main() {
  const args = process.argv.slice(2)
  const nodeExeIndex = args.indexOf('--node-exe')
  const nodeExe = nodeExeIndex >= 0 ? args[nodeExeIndex + 1] : undefined
  try {
    const result = await resolveNodeExe({ nodeExe })
    process.stdout.write(`${result.exePath}\n`)
  } catch (error) {
    process.stderr.write(`获取 Node 运行时失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
