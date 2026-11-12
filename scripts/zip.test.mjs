/**
 * 确定性 zip 写入器：可复现、条目有序、能被系统 tar 解出。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectFiles, crc32, dosDateTime, listZipEntries, writeZip } from './zip.mjs'

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
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-zip-'))
  dirs.push(dir)
  return dir
}

/**
 * 造一棵小目录树。
 * @param {string} root 根目录
 */
function fixture(root) {
  mkdirSync(path.join(root, 'node_modules', '@ledger', 'server', 'dist'), { recursive: true })
  writeFileSync(path.join(root, 'VERSION'), '{"version":"1.0.0"}\n')
  writeFileSync(path.join(root, 'node.exe'), Buffer.alloc(1024, 7))
  writeFileSync(path.join(root, 'node_modules', '@ledger', 'server', 'dist', 'index.js'), 'export const a = 1\n')
}

/**
 * 计算文件 SHA-256。
 * @param {string} file 路径
 * @returns {string}
 */
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

describe('确定性 zip', () => {
  it('同一输入两次打包字节一致', () => {
    const root = tempDir()
    fixture(root)
    const first = path.join(tempDir(), 'a.zip')
    const second = path.join(tempDir(), 'b.zip')
    const info = writeZip({ rootDir: root, outFile: first })
    writeZip({ rootDir: root, outFile: second })
    expect(info.entries).toBe(3)
    expect(sha256(first)).toBe(sha256(second))
  })

  it('条目按名称排序且路径使用正斜杠', () => {
    const root = tempDir()
    fixture(root)
    const out = path.join(tempDir(), 'a.zip')
    writeZip({ rootDir: root, outFile: out })
    const entries = listZipEntries(out)
    expect(entries).toEqual([...entries].sort())
    expect(entries).toContain('node_modules/@ledger/server/dist/index.js')
    expect(collectFiles(root)).toEqual(entries)
  })

  it('系统 tar 能解出且内容一致（Go archive/zip 与 bsdtar 均兼容）', () => {
    const root = tempDir()
    fixture(root)
    const out = path.join(tempDir(), 'a.zip')
    writeZip({ rootDir: root, outFile: out })

    const tar = path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe')
    const list = spawnSync(tar, ['-tf', out], { encoding: 'utf8' })
    expect(list.status).toBe(0)
    expect(list.stdout).toContain('VERSION')

    const extractDir = tempDir()
    const extracted = spawnSync(tar, ['-xf', out, '-C', extractDir], { encoding: 'utf8' })
    expect(extracted.status).toBe(0)
    expect(readFileSync(path.join(extractDir, 'VERSION'), 'utf8')).toBe('{"version":"1.0.0"}\n')
    expect(readFileSync(path.join(extractDir, 'node.exe')).length).toBe(1024)
  })

  it('level=0 时仅存储', () => {
    const root = tempDir()
    fixture(root)
    const out = path.join(tempDir(), 'stored.zip')
    writeZip({ rootDir: root, outFile: out, level: 0 })
    expect(listZipEntries(out)).toContain('node.exe')
  })
})

describe('工具函数', () => {
  it('crc32 与已知值一致', () => {
    // "123456789" 的 CRC-32 标准值
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('DOS 时间字段覆盖 1980 年下限', () => {
    const { dosDate } = dosDateTime(new Date(Date.UTC(1970, 0, 1)))
    expect(dosDate >> 9).toBe(0) // 1980 年
    const modern = dosDateTime(new Date(Date.UTC(2026, 10, 12, 10, 20, 30)))
    expect(modern.dosDate >> 9).toBe(46) // 2026 - 1980
    expect(modern.dosTime >> 11).toBe(10)
  })
})
