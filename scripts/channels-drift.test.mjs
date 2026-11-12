/**
 * 渠道清单漂移检查：分发包产物 ↔ channels/channels.json ↔ winget 清单 ↔ 文档/工作流。
 *
 * 为什么需要：渠道清单一手写就会漂——版本号改了 sha256 没改、URL 忘了改名、
 * 生成的 yaml 被手改回旧版本，结果用户装到的东西和声明的校验值不符（winget 直接拒装）。
 * 这里把「生成器输出」当成唯一真相，磁盘文件必须逐字节等于重新渲染的结果。
 *
 * 另外守住两条容易漏掉的约定：
 *   · winget 的安装地址必须指向 GitHub（主渠道），不是 Gitee 镜像；
 *   · 发布工作流必须仍然执行「生成清单 → 发版守卫 → 发 Release」这三步。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHANNELS_SCHEMA,
  WINGET_MANIFEST_VERSION,
  WINGET_PACKAGE_ID,
  artifactName,
  renderChannelsJson,
  renderWingetManifests,
  wingetManifestDir,
} from './channels.mjs'
import { verifyRelease } from './release-guard.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 读取 JSON 文件。 */
function readJson(file) {
  return JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))
}

/** 读取文本文件。 */
function readText(file) {
  return readFileSync(path.join(ROOT, file), 'utf8')
}

const pkg = readJson('package.json')
const channels = readJson('channels/channels.json')
const manifests = renderWingetManifests(channels)
const installerManifest = manifests.find((item) => item.file.endsWith('.installer.yaml'))

describe('渠道清单与分发包一致', () => {
  it('channels.json 的版本、产物名与 package.json 一致', () => {
    expect(channels.schema).toBe(CHANNELS_SCHEMA)
    expect(channels.version).toBe(String(pkg.version))
    expect(channels.artifact).toBe(artifactName(String(pkg.version)))
    expect(channels.sha256, 'sha256 必须是 64 位小写十六进制').toMatch(/^[0-9a-f]{64}$/)
    expect(channels.sizeBytes).toBeGreaterThan(0)
  })

  it('主渠道是 GitHub Releases，Gitee 是同一份产物的镜像', () => {
    const github = channels.distribution.github
    const gitee = channels.distribution.gitee
    expect(github.url).toBe(
      `https://github.com/${github.repository}/releases/download/v${channels.version}/${channels.artifact}`,
    )
    expect(gitee.url).toBe(
      `https://gitee.com/${gitee.repository}/releases/download/v${channels.version}/${channels.artifact}`,
    )
    // 同一 artifact 名 = 同一份字节 = 同一个 sha256：镜像不重新打包。
    expect(path.posix.basename(gitee.url)).toBe(channels.artifact)
    expect(github.tag).toBe(`v${channels.version}`)
    expect(gitee.tag).toBe(github.tag)
  })

  it('winget 的安装地址指向 GitHub Releases（不用镜像域名）', () => {
    expect(channels.winget.packageIdentifier).toBe(WINGET_PACKAGE_ID)
    expect(channels.winget.version).toBe(channels.version)
    expect(channels.winget.installerUrl).toBe(channels.distribution.github.url)
    expect(channels.winget.installerUrl).not.toContain('gitee.com')
    expect(channels.winget.installerSha256).toBe(channels.sha256)
    expect(channels.winget.manifestDir).toBe(wingetManifestDir(channels.version))
  })

  it('磁盘上的 channels.json 与生成器输出逐字节一致', () => {
    expect(readText('channels/channels.json')).toBe(renderChannelsJson(channels))
  })

  it('磁盘上的 winget 清单与生成器输出逐字节一致（含本地化文件）', () => {
    for (const { file, content } of manifests) {
      expect(existsSync(path.join(ROOT, file)), `缺少清单 ${file}`).toBe(true)
      expect(readText(file), `${file} 与生成器输出不一致，请运行 npm run package:channels`).toBe(content)
    }
  })

  it('winget 清单声明了 zip + 嵌套 portable，别名与相对路径正确', () => {
    expect(installerManifest).toBeDefined()
    const text = installerManifest.content
    expect(text).toContain('InstallerType: zip')
    expect(text).toContain('NestedInstallerType: portable')
    expect(text).toContain('Scope: user')
    expect(text).toContain(`RelativeFilePath: '${channels.artifact.replace(/\.zip$/, '')}\\ledger.exe'`)
    expect(text).toContain(`PortableCommandAlias: ${channels.winget.moniker}`)
    expect(text).toContain(`InstallerSha256: ${channels.sha256.toUpperCase()}`)
    expect(text).toContain('Architecture: x64')
  })

  it('每个清单都带 ManifestVersion / ManifestType，且版本号一致', () => {
    const expectedTypes = new Map([
      ['.yaml', 'version'],
      ['.locale.en-US.yaml', 'defaultLocale'],
      ['.locale.zh-CN.yaml', 'defaultLocale'],
      ['.installer.yaml', 'installer'],
    ])
    for (const { file, content } of manifests) {
      expect(content).toContain(`ManifestVersion: ${WINGET_MANIFEST_VERSION}`)
      expect(content).toContain(`PackageIdentifier: ${WINGET_PACKAGE_ID}`)
      expect(content).toContain(`PackageVersion: ${channels.version}`)
      // 从最长后缀开始匹配：`.locale.en-US.yaml` 也以 `.yaml` 结尾。
      const suffix = [...expectedTypes.keys()]
        .sort((left, right) => right.length - left.length)
        .find((key) => file.endsWith(key))
      expect(suffix, `${file} 命名不符合 winget 约定`).toBeDefined()
      expect(content).toContain(`ManifestType: ${expectedTypes.get(suffix)}`)
    }
    // DefaultLocale 必须指向实际存在的本地化清单。
    const versionManifest = manifests.find((item) => item.file === `${wingetManifestDir(channels.version)}/${WINGET_PACKAGE_ID}.yaml`)
    const locale = versionManifest.content.match(/DefaultLocale:\s*(\S+)/)?.[1]
    expect(locale).toBe('en-US')
    expect(existsSync(path.join(ROOT, wingetManifestDir(channels.version), `${WINGET_PACKAGE_ID}.locale.${locale}.yaml`))).toBe(true)
  })

  const artifactPath = path.join('release', channels.artifact)
  it.skipIf(!existsSync(path.join(ROOT, artifactPath)))(
    '本地存在分发包时，版本/tag/sha256/SHA256SUMS/渠道清单必须全部对齐',
    () => {
      const result = verifyRelease({ version: channels.version, dir: path.join(ROOT, 'release') })
      expect(result.problems).toEqual([])
      expect(result.sha256).toBe(channels.sha256)
    },
  )
})

describe('渠道文档与发布工作流同步', () => {
  it('分发文档写明了 GitHub 主渠道与 winget 安装方式', () => {
    const text = readText('docs/distribution.md')
    expect(text).toContain(`github.com/${channels.distribution.github.repository}/releases`)
    expect(text).toContain(`gitee.com/${channels.distribution.gitee.repository}/releases`)
    expect(text).toContain(`winget install ${WINGET_PACKAGE_ID}`)
    expect(text).toContain('npm run package:channels')
  })

  it('README 给出 GitHub Releases 下载入口', () => {
    const text = readText('README.md')
    expect(text).toContain(`github.com/${channels.distribution.github.repository}/releases`)
  })

  it('发布工作流仍然执行「出包 → 生成清单 → 发版守卫 → 发 Release」', () => {
    const workflow = readText('.github/workflows/release.yml')
    expect(workflow).toMatch(/tags:\s*(?:\n\s*-\s*'v\*'|\['v\*'\])/)
    for (const step of [
      'npm run package:payload',
      'npm run package:exe',
      'npm run package:channels',
      'scripts/release-guard.mjs',
      'gh release create',
    ]) {
      expect(workflow, `release.yml 缺少步骤：${step}`).toContain(step)
    }
  })
})
