/**
 * 发版守卫：确保「版本号 / tag / 分发包 / 校验清单 / 渠道清单」互相对得上。
 *
 * 这几样东西任何一处对不上，都会把错误发布给用户：tag 与版本不一致 → 用户下载到
 * 名字对不上的包；zip 与 SHA256SUMS 不一致 → 校验失败；zip 与 channels.json 不一致 →
 * winget 装到的东西和声明的 sha256 不符（安装直接被拒）。
 *
 * 用法：
 *   node scripts/release-guard.mjs [--tag v1.0.0] [--dir release]
 *
 * 退出码：0 通过；1 存在不一致（逐条打印原因）。
 * GitHub Actions 的 release 工作流与 docs/distribution.md 的发版清单都用它。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
 * 读取 JSON 文件；不存在时返回 null。
 * @param {string} file 路径
 * @returns {any | null}
 */
function readJsonIfExists(file) {
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * 取校验清单里某个文件对应的小写 sha256。
 * @param {string} text 校验清单内容（`<sha>  <name>` 每行一条）
 * @param {string} fileName 文件名
 * @returns {string | null}
 */
function shaFromSums(text, fileName) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/)
    if (match !== null && path.posix.basename(match[2].replaceAll('\\', '/')) === fileName) {
      return match[1].toLowerCase()
    }
  }
  return null
}

/**
 * 校验发版产物；返回问题清单（空数组表示全部一致）。
 * @param {{ version: string, tag?: string, dir: string }} input 校验输入
 * @returns {{ problems: string[], artifact: string, sha256: string | null, sizeBytes: number }} 结果
 */
export function verifyRelease({ version, tag, dir }) {
  const problems = []
  const artifact = `ledger-${version}-win-x64.zip`
  const zipPath = path.join(dir, artifact)

  if (tag !== undefined && tag !== '') {
    const normalized = tag.replace(/^v/, '')
    if (normalized !== version) {
      problems.push(`tag ${tag} 与 package.json 版本 ${version} 不一致（应打 v${version}）`)
    }
  }

  if (!existsSync(zipPath)) {
    problems.push(`缺少分发包：${path.relative(ROOT, zipPath)}（先运行 npm run package）`)
    return { problems, artifact, sha256: null, sizeBytes: 0 }
  }

  const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
  const sizeBytes = statSync(zipPath).size

  const sidecar = `${zipPath}.sha256`
  if (!existsSync(sidecar)) {
    problems.push(`缺少校验文件：${path.relative(ROOT, sidecar)}`)
  } else {
    const declared = readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0].toLowerCase()
    if (declared !== sha256) {
      problems.push(`${path.basename(sidecar)} 声明的 sha256 ${declared} 与实际 ${sha256} 不一致`)
    }
  }

  const sumsPath = path.join(dir, 'SHA256SUMS')
  if (!existsSync(sumsPath)) {
    problems.push('缺少校验清单：release/SHA256SUMS')
  } else {
    const declared = shaFromSums(readFileSync(sumsPath, 'utf8'), artifact)
    if (declared === null) {
      problems.push(`SHA256SUMS 中没有 ${artifact} 这一行`)
    } else if (declared !== sha256) {
      problems.push(`SHA256SUMS 声明的 sha256 ${declared} 与实际 ${sha256} 不一致`)
    }
  }

  const channels = readJsonIfExists(path.join(ROOT, 'channels', 'channels.json'))
  if (channels === null) {
    problems.push('缺少渠道清单：channels/channels.json（运行 npm run package:channels）')
  } else {
    if (channels.version !== version) {
      problems.push(`channels/channels.json 的版本 ${channels.version} 与 ${version} 不一致`)
    }
    if (channels.sha256 !== sha256) {
      problems.push(`channels/channels.json 的 sha256 ${channels.sha256} 与实际 ${sha256} 不一致`)
    }
    if (channels.sizeBytes !== sizeBytes) {
      problems.push(`channels/channels.json 的大小 ${channels.sizeBytes} 与实际 ${sizeBytes} 不一致`)
    }
  }

  return { problems, artifact, sha256, sizeBytes }
}

/**
 * 主流程。
 */
function main() {
  const args = parseArgs(process.argv.slice(2))
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const version = args.version ?? String(pkg.version)
  const dir = path.resolve(args.dir ?? path.join(ROOT, 'release'))
  const result = verifyRelease({ version, tag: args.tag, dir })

  if (result.problems.length > 0) {
    process.stderr.write(`发版产物校验失败（版本 ${version}）：\n`)
    for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`)
    process.exitCode = 1
    return
  }

  const sizeMb = (result.sizeBytes / 1024 / 1024).toFixed(1)
  process.stdout.write(
    `发版产物校验通过：${result.artifact}\n` +
      `  版本 ${version} / ${sizeMb} MB / sha256 ${result.sha256}\n` +
      `  校验清单、渠道清单（channels/channels.json）与实际产物一致\n`,
  )
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
}
