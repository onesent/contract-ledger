/**
 * fetch-node 的纯逻辑与来源解析测试（不触网：注入 fetch 桩）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { distPlatformName, isUsableCache, parseShasums, resolveNodeExe, sha256File, verifyHash } from './fetch-node.mjs'

/** 临时目录列表。 */
const dirs = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

/**
 * 创建临时目录。
 * @returns {string}
 */
function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-fetch-node-'))
  dirs.push(dir)
  return dir
}

/**
 * 计算 Buffer 的 SHA-256。
 * @param {Buffer} buffer 内容
 * @returns {string}
 */
function hashOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

describe('平台名映射', () => {
  it('win32 映射为 win，其余保持', () => {
    expect(distPlatformName('win32')).toBe('win')
    expect(distPlatformName('darwin')).toBe('darwin')
    expect(distPlatformName('linux')).toBe('linux')
  })
})

describe('SHASUMS 解析', () => {
  it('取出指定文件的哈希', () => {
    const text = [
      'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999  node-v24.9.0-win-x64.zip',
      '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff *node-v24.9.0-darwin-x64.tar.gz',
    ].join('\n')
    expect(parseShasums(text, 'node-v24.9.0-win-x64.zip')).toBe(
      'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999',
    )
    expect(parseShasums(text, 'node-v24.9.0-darwin-x64.tar.gz')).toBe(
      '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    )
    expect(parseShasums(text, 'missing.zip')).toBeNull()
  })
})

describe('哈希校验', () => {
  it('匹配时通过，不匹配时抛出中文错误', () => {
    const dir = tempDir()
    const file = path.join(dir, 'node.zip')
    writeFileSync(file, 'payload')
    const digest = sha256File(file)
    expect(() => verifyHash(file, digest, '归档')).not.toThrow()
    expect(() => verifyHash(file, 'f'.repeat(64), '归档')).toThrow(/校验失败/)
  })
})

describe('Node 来源解析', () => {
  it('--node-exe 直取本地文件', async () => {
    const dir = tempDir()
    const exe = path.join(dir, 'node.exe')
    writeFileSync(exe, 'MZ')
    const result = await resolveNodeExe({ nodeExe: exe, cacheDir: path.join(dir, 'cache'), log: () => {} })
    expect(result.source).toBe('explicit')
    expect(result.exePath).toBe(path.resolve(exe))
  })

  it('--node-exe 指向不存在的文件时报错', async () => {
    const dir = tempDir()
    await expect(
      resolveNodeExe({ nodeExe: path.join(dir, 'missing.exe'), cacheDir: path.join(dir, 'cache'), log: () => {} }),
    ).rejects.toThrow(/不存在/)
  })

  it('缓存归档命中时不触网（缓存内容不可用时才下载）', async () => {
    const dir = tempDir()
    const cacheDir = path.join(dir, 'cache')
    mkdirSync(cacheDir, { recursive: true })
    const archive = path.join(cacheDir, `node-${process.version}-win-x64.zip`)
    // 放一个非 zip 的占位文件：能命中缓存，但解压会失败，从而证明没有走下载分支。
    writeFileSync(archive, 'not-a-zip')
    expect(isUsableCache(archive)).toBe(true)

    let fetched = false
    const fetchImpl = async () => {
      fetched = true
      throw new Error('不应触网')
    }
    await expect(
      resolveNodeExe({ cacheDir, nodeVersion: process.version, fetchImpl, log: () => {} }),
    ).rejects.toThrow()
    expect(fetched).toBe(false)
  })

  it('下载时用官方校验值核对，不匹配则报错且不落缓存', async () => {
    const dir = tempDir()
    const cacheDir = path.join(dir, 'cache')
    const version = 'v24.9.0'
    const archiveName = `node-${version}-win-x64.zip`
    const bytes = Buffer.from('fake-node-archive')
    const wrongHash = 'f'.repeat(64)

    const fetchImpl = async (url) => {
      if (String(url).endsWith('SHASUMS256.txt')) {
        return { ok: true, status: 200, text: async () => `${wrongHash}  ${archiveName}\n` }
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }
    }

    await expect(
      resolveNodeExe({ cacheDir, nodeVersion: version, fetchImpl, log: () => {} }),
    ).rejects.toThrow(/校验失败/)
    expect(isUsableCache(path.join(cacheDir, archiveName))).toBe(false)
  })

  it('下载失败时给出可操作提示', async () => {
    const dir = tempDir()
    const fetchImpl = async () => ({ ok: false, status: 503, text: async () => '' })
    await expect(
      resolveNodeExe({ cacheDir: path.join(dir, 'cache'), nodeVersion: 'v24.9.0', fetchImpl, log: () => {} }),
    ).rejects.toThrow(/HTTP 503/)
  })
})

describe('哈希一致性', () => {
  it('sha256File 与 Node 自身计算一致', () => {
    const dir = tempDir()
    const file = path.join(dir, 'x')
    writeFileSync(file, 'ledger')
    expect(sha256File(file)).toBe(hashOf(Buffer.from('ledger')))
  })
})
