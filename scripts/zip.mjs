/**
 * 确定性 zip 写入器（不依赖外部工具）。
 *
 * 载荷需要「同版本可复现」：条目按名称排序、修改时间固定为构建时间戳，
 * 因此同一份输入（同 commit、同依赖、同 Node 运行时）产出的字节完全一致。
 * 仅使用 store/deflate，Go 的 archive/zip 可直接读取。
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

/** CRC-32 查表。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/**
 * 计算 CRC-32。
 * @param {Buffer} buffer 内容
 * @returns {number}
 */
export function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * 把时间转换为 DOS 日期/时间字段（zip 精度 2 秒，1980 年起）。
 * @param {Date} date 时间
 * @returns {{ dosTime: number, dosDate: number }}
 */
export function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear())
  const dosTime =
    (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  return { dosTime, dosDate }
}

/**
 * 递归收集目录内的文件（相对路径，正斜杠，已排序）。
 * @param {string} rootDir 根目录
 * @returns {string[]}
 */
export function collectFiles(rootDir) {
  const files = []
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        files.push(path.relative(rootDir, full).split(path.sep).join('/'))
      }
    }
  }
  walk(rootDir)
  files.sort()
  return files
}

/**
 * 按 entries 选择待打包文件；未指定时打包整个 rootDir。
 * @param {string} rootDir 根目录
 * @param {string[] | undefined} entries 相对路径列表
 * @returns {string[]} 相对路径（正斜杠，已排序去重）
 */
function selectFiles(rootDir, entries) {
  if (!entries || entries.length === 0) {
    return collectFiles(rootDir)
  }
  /** @type {Set<string>} */
  const selected = new Set()
  for (const entry of entries) {
    const normalized = entry.split('\\').join('/').replace(/\/+$/, '')
    const full = path.join(rootDir, normalized.split('/').join(path.sep))
    const info = statSync(full)
    if (info.isDirectory()) {
      for (const rel of collectFiles(full)) {
        selected.add(`${normalized}/${rel}`)
      }
    } else {
      selected.add(normalized)
    }
  }
  return [...selected].sort()
}

/**
 * 生成 zip 文件。
 * @param {object} options 选项
 * @param {string} options.rootDir 待打包目录
 * @param {string} options.outFile 输出 zip 路径
 * @param {Date} [options.mtime] 条目时间戳（默认 1980-01-01，保证可复现）
 * @param {number} [options.level] deflate 级别（0 表示仅存储）
 * @param {string[]} [options.entries] 只打包这些相对路径（目录会被递归展开，保留前缀）
 * @returns {{ entries: number, bytes: number }}
 */
export function writeZip({
  rootDir,
  outFile,
  mtime = new Date(Date.UTC(1980, 0, 1)),
  level = 6,
  entries,
}) {
  const files = selectFiles(rootDir, entries)
  const { dosTime, dosDate } = dosDateTime(mtime)
  const chunks = []
  const central = []
  let offset = 0

  for (const name of files) {
    const source = path.join(rootDir, name.split('/').join(path.sep))
    const content = readFileSync(source)
    const deflated = level > 0 ? deflateRawSync(content, { level }) : null
    const useDeflate = deflated !== null && deflated.length < content.length
    const data = useDeflate ? deflated : content
    const method = useDeflate ? 8 : 0
    const crc = crc32(content)
    const nameBytes = Buffer.from(name, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBytes, data)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(method, 10)
    header.writeUInt16LE(dosTime, 12)
    header.writeUInt16LE(dosDate, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(content.length, 24)
    header.writeUInt16LE(nameBytes.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0o644 << 16, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, nameBytes)

    offset += local.length + nameBytes.length + data.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  mkdirSync(path.dirname(outFile), { recursive: true })
  writeFileSync(outFile, Buffer.concat([...chunks, centralBuffer, end]))
  return { entries: files.length, bytes: statSync(outFile).size }
}

/**
 * 读取 zip 条目名列表（自检与测试用）。
 * @param {string} file zip 路径
 * @returns {string[]}
 */
export function listZipEntries(file) {
  const buffer = readFileSync(file)
  const entries = []
  const endOffset = buffer.length - 22
  if (endOffset < 0 || buffer.readUInt32LE(endOffset) !== 0x06054b50) {
    throw new Error('不是有效的 zip（缺少中央目录结束记录）')
  }
  const count = buffer.readUInt16LE(endOffset + 10)
  let pointer = buffer.readUInt32LE(endOffset + 16)
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('中央目录损坏')
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    entries.push(buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8'))
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
