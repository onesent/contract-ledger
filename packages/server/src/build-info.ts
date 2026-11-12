/**
 * 构建信息解析：版本号与 Node 版本门槛的单一来源。
 *
 * 解析顺序（前者优先）：
 * 1. 向上找到的工作区根 `package.json`（含 `workspaces` 字段）——开发态；
 * 2. 与本模块同目录的 `build-info.json`——便携载荷（打包脚本生成，随 `dist` 入包）；
 * 3. `SERVER_VERSION` 常量——最终回落。
 *
 * 载荷内不存在根 `package.json`（只有载荷自己的 package.json，无 `workspaces`），
 * 因此两条路径不会互相污染：开发态即使 `dist/build-info.json` 是旧构建，也以 package.json 为准。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVER_VERSION } from './version.js'

/** 构建信息文件内容（由 `scripts/package-payload.mjs` 生成）。 */
export interface BuildInfo {
  /** 语义化版本号，与根 package.json 一致。 */
  version: string
  /** 构建时的 git 提交短哈希。 */
  gitSha: string
  /** 构建时间（ISO-8601 UTC）。 */
  builtAt: string
  /** Node 版本门槛（取自根 package.json 的 engines.node，如 `>=24.0.0`）。 */
  node: string
  /** 数据库结构版本。 */
  schema: number
}

/** 解析结果：版本号、Node 门槛与来源。 */
export interface ResolvedBuildInfo {
  /** 对外版本号。 */
  version: string
  /** Node 最低版本（形如 `24.0.0`）。 */
  minNodeVersion: string
  /** 结果来源，便于诊断与测试。 */
  source: 'package.json' | 'build-info.json' | 'fallback'
}

/** 无任何来源时的 Node 最低版本（与根 package.json 的 engines.node 一致，由单测守护）。 */
export const DEFAULT_MIN_NODE_VERSION = '24.0.0'

/** 向上查找的最大层数：载荷内 server 包位于 `<app>/node_modules/@ledger/server/dist/`。 */
const MAX_WALK_UP = 5

/** 本模块所在目录（开发态为 `packages/server/dist`，载荷内为 `node_modules/@ledger/server/dist`）。 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

/**
 * 读取并解析 JSON；文件不存在或内容非法时返回 null。
 * @param file 文件路径
 * @returns 解析结果或 null
 */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

/**
 * 判断是否为普通对象。
 * @param value 任意值
 * @returns 是对象返回 true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 从 `engines.node` 形式的范围中取出最低版本号。
 * @param range 形如 `>=24.0.0`、`^24.1.0`、`24.0.0` 的字符串
 * @returns 版本号字符串；无法解析返回 null
 */
export function parseMinNodeVersion(range: unknown): string | null {
  if (typeof range !== 'string') return null
  const match = range.match(/(\d+)\.(\d+)\.(\d+)/)
  if (match === null) return null
  return `${match[1]}.${match[2]}.${match[3]}`
}

/**
 * 向上查找工作区根 package.json（含 `workspaces` 字段）。
 * @param startDir 起始目录
 * @param maxLevels 最多向上层数
 * @returns 文件路径；未找到返回 null
 */
export function findWorkspacePackageJson(startDir: string = MODULE_DIR, maxLevels: number = MAX_WALK_UP): string | null {
  let current = path.resolve(startDir)
  for (let level = 0; level <= maxLevels; level += 1) {
    const candidate = path.join(current, 'package.json')
    const parsed = readJson(candidate)
    if (isRecord(parsed) && Array.isArray(parsed.workspaces) && typeof parsed.version === 'string') {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/**
 * 解析构建信息。
 * @param startDir 起始目录（默认本模块目录）
 * @returns 版本号、Node 门槛与来源
 */
export function resolveBuildInfo(startDir: string = MODULE_DIR): ResolvedBuildInfo {
  const workspacePkg = findWorkspacePackageJson(startDir)
  if (workspacePkg !== null) {
    const parsed = readJson(workspacePkg)
    if (isRecord(parsed) && typeof parsed.version === 'string') {
      const engines = isRecord(parsed.engines) ? parsed.engines.node : undefined
      return {
        version: parsed.version,
        minNodeVersion: parseMinNodeVersion(engines) ?? DEFAULT_MIN_NODE_VERSION,
        source: 'package.json',
      }
    }
  }

  const info = readJson(path.join(startDir, 'build-info.json'))
  if (isRecord(info) && typeof info.version === 'string') {
    return {
      version: info.version,
      minNodeVersion: parseMinNodeVersion(info.node) ?? DEFAULT_MIN_NODE_VERSION,
      source: 'build-info.json',
    }
  }

  return { version: SERVER_VERSION, minNodeVersion: DEFAULT_MIN_NODE_VERSION, source: 'fallback' }
}

/**
 * 把 `a.b.c` 解析为三元组，忽略预发布后缀。
 * @param value 版本号
 * @returns 三元组
 */
function triple(value: string): [number, number, number] {
  const parts = value.trim().split('.')
  return [
    Number.parseInt(parts[0] ?? '0', 10) || 0,
    Number.parseInt(parts[1] ?? '0', 10) || 0,
    Number.parseInt(parts[2] ?? '0', 10) || 0,
  ]
}

/**
 * 判断运行时 Node 版本是否满足最低要求。
 * @param current 当前版本（如 `process.versions.node`）
 * @param minimum 最低版本
 * @returns 满足返回 true
 */
export function isNodeSupported(current: string, minimum: string): boolean {
  const a = triple(current)
  const b = triple(minimum)
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) > (b[index] ?? 0)) return true
    if ((a[index] ?? 0) < (b[index] ?? 0)) return false
  }
  return true
}

/**
 * 断言运行时 Node 版本满足最低要求；不满足时抛出中文、可操作错误。
 * @param current 当前版本
 * @param minimum 最低版本
 */
export function assertNodeSupported(current: string, minimum: string): void {
  if (isNodeSupported(current, minimum)) return
  throw new Error(
    `Node.js 版本过低：当前 ${current}，要求 ≥ ${minimum}。` +
      '请使用随交付物提供的运行时，或升级本机 Node.js 后重新启动。',
  )
}
