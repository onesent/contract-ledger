/**
 * 分发渠道清单生成器：把「已产出的分发包」渲染成各渠道的元数据。
 *
 * 核心原则：版本号、校验值、下载地址只有一个来源——`release/ledger-<version>-win-x64.zip`
 * 本身。手写清单必然随版本漂移（版本号改了 hash 没改、URL 忘了改名），所以这里
 * 全部由产物推导，再由 `scripts/channels-drift.test.mjs` 守住生成物与产物/文档一致。
 *
 * 生成物（提交入库；供漂移测试与 winget 提交使用）：
 * - `channels/channels.json`：版本 / 大小 / sha256 / 各渠道 URL 的机器可读快照
 * - `channels/winget/manifests/o/Onesent/Ledger/<version>/*.yaml`：winget 三个清单 + 本地化
 *
 * 用法：
 *   node scripts/channels.mjs [--zip <path>] [--version <v>]
 *                             [--github <owner/repo>] [--gitee <owner/repo>]
 *
 * 只想用已发布产物（不想下载 45MB zip）时，可直接给它算好的校验值：
 *   node scripts/channels.mjs --version 1.0.0 --sha256 <hex> --size <bytes>
 * 两者必须同时提供（CI 发布后用 Release 资产的 SHA256SUMS / size 回填仓库快照）。
 *
 * 渠道分工：GitHub Releases 是主渠道（winget 的 InstallerUrl 指向它），Gitee Release
 * 是同一份产物的镜像（同一 sha256，只换下载域名）。运行期不发任何网络请求，
 * 渠道只负责托管，升级仍是「换一个程序目录」。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** channels.json 的结构版本（改字段时递增）。 */
export const CHANNELS_SCHEMA = 1
/** winget 包标识符：Publisher.Package，首次提交后在 winget-pkgs 里固定。 */
export const WINGET_PACKAGE_ID = 'Onesent.Ledger'
/** winget 清单 schema 版本。 */
export const WINGET_MANIFEST_VERSION = '1.10.0'
/** winget 命令别名（`ledger` 比 `ledger.exe` 好用）。 */
export const WINGET_MONIKER = 'ledger'

/** 默认渠道仓库（--github / --gitee 或环境变量可覆盖）。 */
const DEFAULT_GITHUB_REPO = 'onesent/contract-ledger'
const DEFAULT_GITEE_REPO = 'sentone/contract-ledger'

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
 * 读取 JSON 文件。
 * @param {string} file 路径
 * @returns {any}
 */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * 计算文件 SHA-256（小写十六进制）。
 * @param {string} file 路径
 * @returns {string}
 */
export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * 分发包文件名（顶层目录同名，启动器与文档都依赖这个形状）。
 * @param {string} version 版本号
 * @returns {string}
 */
export function artifactName(version) {
  return `ledger-${version}-win-x64.zip`
}

/**
 * 计算某个渠道的下载地址。
 * @param {'github' | 'gitee'} host 渠道
 * @param {string} repository owner/repo
 * @param {string} version 版本号
 * @returns {string}
 */
export function releaseUrl(host, repository, version) {
  const domain = host === 'github' ? 'github.com' : 'gitee.com'
  return `https://${domain}/${repository}/releases/download/v${version}/${artifactName(version)}`
}

/**
 * 组装渠道清单条目（写进 channels.json 的对象，也是渲染清单的唯一输入）。
 * @param {{ version: string, sizeBytes: number, sha256: string, githubRepo?: string, giteeRepo?: string }} input 产物信息
 * @returns {Record<string, any>}
 */
export function buildEntry({ version, sizeBytes, sha256, githubRepo, giteeRepo }) {
  const github = githubRepo ?? DEFAULT_GITHUB_REPO
  const gitee = giteeRepo ?? DEFAULT_GITEE_REPO
  const artifact = artifactName(version)
  return {
    schema: CHANNELS_SCHEMA,
    version,
    artifact,
    sizeBytes,
    sha256,
    distribution: {
      github: { repository: github, tag: `v${version}`, url: releaseUrl('github', github, version) },
      gitee: { repository: gitee, tag: `v${version}`, url: releaseUrl('gitee', gitee, version) },
    },
    winget: {
      packageIdentifier: WINGET_PACKAGE_ID,
      moniker: WINGET_MONIKER,
      version,
      // winget 的 InstallerUrl 必须稳定可达：GitHub Release 资产是主渠道。
      installerUrl: releaseUrl('github', github, version),
      installerSha256: sha256,
      manifestDir: wingetManifestDir(version),
    },
  }
}

/**
 * winget 清单目录（winget-pkgs 的目录约定：首字母小写/publisher/package/version）。
 * @param {string} version 版本号
 * @returns {string} 相对仓库根的 POSIX 路径
 */
export function wingetManifestDir(version) {
  const [publisher, packageName] = WINGET_PACKAGE_ID.split('.')
  return `channels/winget/manifests/${publisher[0].toLowerCase()}/${publisher}/${packageName}/${version}`
}

/**
 * 序列化 channels.json（固定缩进与字段顺序，保证同产物同字节）。
 * @param {Record<string, any>} entry 渠道条目
 * @returns {string}
 */
export function renderChannelsJson(entry) {
  return `${JSON.stringify(entry, null, 2)}\n`
}

/**
 * 渲染 winget 清单的四个文件。
 * @param {Record<string, any>} entry 渠道条目
 * @returns {{ file: string, content: string }[]} 文件与内容（file 为相对仓库根的 POSIX 路径）
 */
export function renderWingetManifests(entry) {
  const { version } = entry
  const [publisher] = WINGET_PACKAGE_ID.split('.')
  const dir = wingetManifestDir(version)
  const githubUrl = entry.distribution.github.url
  const repoUrl = githubUrl.split('/releases/')[0]
  const relativeExe = `${path.posix.basename(entry.artifact, '.zip')}\\ledger.exe`
  const header = `# 由 scripts/channels.mjs 从已发布的分发包生成，请勿手改（改生成器）。\n`

  const versionManifest =
    header +
    `PackageIdentifier: ${WINGET_PACKAGE_ID}\n` +
    `PackageVersion: ${version}\n` +
    `DefaultLocale: en-US\n` +
    `ManifestType: version\n` +
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}\n`

  const englishLocale =
    header +
    `PackageIdentifier: ${WINGET_PACKAGE_ID}\n` +
    `PackageVersion: ${version}\n` +
    `PackageLocale: en-US\n` +
    `Publisher: ${publisher}\n` +
    `PublisherUrl: ${repoUrl}\n` +
    `PackageName: Ledger\n` +
    `PackageUrl: ${repoUrl}\n` +
    `License: MIT\n` +
    `LicenseUrl: ${repoUrl}/blob/main/LICENSE\n` +
    `ShortDescription: Offline contract ledger: local service + SQLite + CLI + MCP + Vue UI.\n` +
    `Description: A local-first contract ledger. The program is a self-contained directory (bundled Node runtime, SQLite, CLI, MCP server and web UI); business data lives in %LOCALAPPDATA%\\ledger and is never uploaded. No admin rights required.\n` +
    `Tags:\n` +
    `  - contract\n` +
    `  - ledger\n` +
    `  - sqlite\n` +
    `  - offline\n` +
    `  - cli\n` +
    `ReleaseNotesUrl: ${repoUrl}/releases/tag/v${version}\n` +
    `ManifestType: defaultLocale\n` +
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}\n`

  const chineseLocale =
    header +
    `PackageIdentifier: ${WINGET_PACKAGE_ID}\n` +
    `PackageVersion: ${version}\n` +
    `PackageLocale: zh-CN\n` +
    `Publisher: ${publisher}\n` +
    `PublisherUrl: ${repoUrl}\n` +
    `PackageName: 台账\n` +
    `PackageUrl: ${repoUrl}\n` +
    `License: MIT\n` +
    `LicenseUrl: ${repoUrl}/blob/main/LICENSE\n` +
    `ShortDescription: 离线合同台账：本地服务 + SQLite + CLI + MCP + Vue 前端。\n` +
    `Description: 本地优先的合同管理台账。程序是一个自包含目录（内置 Node 运行时、SQLite、CLI、MCP 服务与网页界面），业务数据存放在 %LOCALAPPDATA%\\ledger，不会上传。无需管理员权限。\n` +
    `Tags:\n` +
    `  - 合同\n` +
    `  - 台账\n` +
    `  - sqlite\n` +
    `  - 离线\n` +
    `  - 命令行\n` +
    `ReleaseNotesUrl: ${repoUrl}/releases/tag/v${version}\n` +
    `ManifestType: defaultLocale\n` +
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}\n`

  // zip 安装：整个归档解压到包目录，再为嵌套 exe 建链接。
  // 启动器会解析符号链接（launcher/config.go 的 resolveExeDir），因此链接方式安装也能
  // 找到同目录的 node.exe / VERSION / node_modules。
  const installerManifest =
    header +
    `PackageIdentifier: ${WINGET_PACKAGE_ID}\n` +
    `PackageVersion: ${version}\n` +
    `InstallerType: zip\n` +
    `NestedInstallerType: portable\n` +
    `NestedInstallerFiles:\n` +
    `  - RelativeFilePath: '${relativeExe}'\n` +
    `    PortableCommandAlias: ${WINGET_MONIKER}\n` +
    `Scope: user\n` +
    `Installers:\n` +
    `  - Architecture: x64\n` +
    `    InstallerUrl: ${githubUrl}\n` +
    `    InstallerSha256: ${entry.sha256.toUpperCase()}\n` +
    `ManifestType: installer\n` +
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}\n`

  return [
    { file: `${dir}/${WINGET_PACKAGE_ID}.yaml`, content: versionManifest },
    { file: `${dir}/${WINGET_PACKAGE_ID}.locale.en-US.yaml`, content: englishLocale },
    { file: `${dir}/${WINGET_PACKAGE_ID}.locale.zh-CN.yaml`, content: chineseLocale },
    { file: `${dir}/${WINGET_PACKAGE_ID}.installer.yaml`, content: installerManifest },
  ]
}

/**
 * 主流程：读产物 → 算校验值 → 写清单。
 */
function main() {
  const args = parseArgs(process.argv.slice(2))
  const packageJson = readJson(path.join(ROOT, 'package.json'))
  const version = args.version ?? String(packageJson.version)

  // 两条输入路径：真实产物（默认，最可信）或已发布产物的校验值（回填用）。
  const hasDeclared = args.sha256 !== undefined || args.size !== undefined
  let sha256
  let sizeBytes
  let zipPath = null
  if (hasDeclared) {
    if (!/^[0-9a-f]{64}$/i.test(String(args.sha256)) || !/^\d+$/.test(String(args.size))) {
      process.stderr.write('--sha256（64 位十六进制）与 --size（字节数）必须同时提供且格式正确。\n')
      process.exitCode = 1
      return
    }
    sha256 = String(args.sha256).toLowerCase()
    sizeBytes = Number(args.size)
  } else {
    zipPath = path.resolve(args.zip ?? path.join(ROOT, 'release', artifactName(version)))
    if (!existsSync(zipPath)) {
      process.stderr.write(
        `找不到分发包：${zipPath}\n` +
          `渠道清单必须从真实产物生成（版本号与 sha256 都取自它）。\n` +
          `请先运行 npm run package（或 npm run package:exe）产出分发包；\n` +
          `若是回填已发布版本，用 --sha256 <hex> --size <bytes> 从 Release 校验值生成。\n`,
      )
      process.exitCode = 1
      return
    }
    sha256 = sha256File(zipPath)
    sizeBytes = statSync(zipPath).size
  }

  const entry = buildEntry({
    version,
    sizeBytes,
    sha256,
    githubRepo: args.github ?? process.env.LEDGER_GITHUB_REPO ?? DEFAULT_GITHUB_REPO,
    giteeRepo: args.gitee ?? process.env.LEDGER_GITEE_REPO ?? DEFAULT_GITEE_REPO,
  })

  const channelsFile = path.join(ROOT, 'channels', 'channels.json')
  mkdirSync(path.dirname(channelsFile), { recursive: true })
  writeFileSync(channelsFile, renderChannelsJson(entry))

  const manifests = renderWingetManifests(entry)
  for (const { file, content } of manifests) {
    const target = path.join(ROOT, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1)
  process.stdout.write(
    `渠道清单已生成（版本 ${version} / ${sizeMb} MB / sha256 ${sha256}）\n` +
      `  ${path.relative(ROOT, channelsFile)}\n` +
      `  ${entry.winget.manifestDir}/（${manifests.length} 个文件）\n` +
      `GitHub 主渠道：${entry.distribution.github.url}\n` +
      `Gitee 镜像：  ${entry.distribution.gitee.url}\n` +
      `winget 提交：wingetcreate update ${WINGET_PACKAGE_ID} --version ${version} --urls ${entry.winget.installerUrl}\n`,
  )
}

// 仅在直接执行时跑主流程：漂移测试会 import 本模块的纯函数。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
}
