/**
 * 构建信息解析：版本与 Node 门槛的来源优先级、非法内容回落、版本比较。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertNodeSupported,
  DEFAULT_MIN_NODE_VERSION,
  findWorkspacePackageJson,
  isNodeSupported,
  parseMinNodeVersion,
  resolveBuildInfo,
} from '../src/build-info.js'
import { SERVER_VERSION } from '../src/version.js'

/** 临时目录列表，afterEach 清理。 */
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

/**
 * 创建临时目录。
 * @returns 目录路径
 */
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-buildinfo-'))
  dirs.push(dir)
  return dir
}

/**
 * 在目录下写 JSON 文件。
 * @param dir 目录
 * @param name 文件名
 * @param value 内容
 * @returns 文件路径
 */
function writeJson(dir: string, name: string, value: unknown): string {
  const file = path.join(dir, name)
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
  return file
}

describe('版本号解析', () => {
  it('开发态从工作区根 package.json 读取版本', () => {
    const root = tempDir()
    writeJson(root, 'package.json', {
      name: 'repo',
      version: '2.3.4',
      workspaces: ['packages/*'],
      engines: { node: '>=24.0.0' },
    })
    const dist = path.join(root, 'packages', 'server', 'dist')
    mkdirSync(dist, { recursive: true })

    const resolved = resolveBuildInfo(dist)
    expect(resolved).toEqual({ version: '2.3.4', minNodeVersion: '24.0.0', source: 'package.json' })
  })

  it('载荷态从同目录 build-info.json 读取版本', () => {
    const app = tempDir()
    const dist = path.join(app, 'node_modules', '@ledger', 'server', 'dist')
    mkdirSync(dist, { recursive: true })
    writeJson(app, 'package.json', { name: 'ledger-payload', private: true })
    writeJson(dist, 'build-info.json', {
      version: '1.4.0',
      gitSha: 'abc1234',
      builtAt: '2026-01-01T00:00:00.000Z',
      node: '>=24.1.0',
      schema: 1,
    })

    const resolved = resolveBuildInfo(dist)
    expect(resolved).toEqual({ version: '1.4.0', minNodeVersion: '24.1.0', source: 'build-info.json' })
  })

  it('工作区 package.json 优先于陈旧的 build-info.json', () => {
    const root = tempDir()
    writeJson(root, 'package.json', { version: '9.9.9', workspaces: ['packages/*'] })
    const dist = path.join(root, 'packages', 'server', 'dist')
    mkdirSync(dist, { recursive: true })
    writeJson(dist, 'build-info.json', { version: '0.0.1', node: '>=24.0.0', schema: 1 })

    expect(resolveBuildInfo(dist).version).toBe('9.9.9')
  })

  it('build-info.json 内容非法时回落到常量', () => {
    const dir = tempDir()
    writeFileSync(path.join(dir, 'build-info.json'), '{ not json')
    const resolved = resolveBuildInfo(dir)
    expect(resolved.source).toBe('fallback')
    expect(resolved.version).toBe(SERVER_VERSION)
    expect(resolved.minNodeVersion).toBe(DEFAULT_MIN_NODE_VERSION)
  })

  it('无任何来源时回落到常量', () => {
    const resolved = resolveBuildInfo(tempDir())
    expect(resolved.source).toBe('fallback')
    expect(resolved.version).toBe(SERVER_VERSION)
  })
})

describe('工作区识别', () => {
  it('只有含 workspaces 的 package.json 才算根', () => {
    const root = tempDir()
    writeJson(root, 'package.json', { version: '1.0.0', workspaces: ['packages/*'] })
    const nested = path.join(root, 'packages', 'server')
    mkdirSync(nested, { recursive: true })
    writeJson(nested, 'package.json', { name: '@ledger/server', version: '0.0.0' })

    expect(findWorkspacePackageJson(nested)).toBe(path.join(root, 'package.json'))
  })

  it('找不到时返回 null', () => {
    expect(findWorkspacePackageJson(tempDir())).toBeNull()
  })
})

describe('Node 门槛', () => {
  it('默认门槛与根 package.json 的 engines.node 一致', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      engines?: { node?: string }
    }
    expect(parseMinNodeVersion(pkg.engines?.node)).toBe(DEFAULT_MIN_NODE_VERSION)
  })

  it('从 engines 范围取出最低版本', () => {
    expect(parseMinNodeVersion('>=24.0.0')).toBe('24.0.0')
    expect(parseMinNodeVersion('^24.1.2')).toBe('24.1.2')
    expect(parseMinNodeVersion('24.0.0')).toBe('24.0.0')
    expect(parseMinNodeVersion(undefined)).toBeNull()
    expect(parseMinNodeVersion('latest')).toBeNull()
  })

  it('比较版本时忽略预发布后缀', () => {
    expect(isNodeSupported('24.0.0', '24.0.0')).toBe(true)
    expect(isNodeSupported('24.0.1', '24.0.0')).toBe(true)
    expect(isNodeSupported('23.9.9', '24.0.0')).toBe(false)
    expect(isNodeSupported('24.0.0-nightly20250101', '24.0.0')).toBe(true)
  })

  it('版本过低时抛出可操作的中文错误', () => {
    expect(() => assertNodeSupported('22.11.0', '24.0.0')).toThrow(/Node\.js 版本过低.*22\.11\.0.*24\.0\.0/s)
    expect(() => assertNodeSupported('24.0.0', '24.0.0')).not.toThrow()
  })
})
