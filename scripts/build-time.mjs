/**
 * 构建时间戳：让同一 commit 的产物与分发包可复现。
 *
 * 优先级：`SOURCE_DATE_EPOCH` > git 提交时间 > 当前时间。
 * 该时间戳同时用于 zip 条目时间与 `VERSION` / `build-info.json` 的 builtAt。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 计算构建时间戳。
 * @returns {Date}
 */
export function buildTimestamp() {
  const epoch = process.env.SOURCE_DATE_EPOCH
  if (epoch !== undefined && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000)
  const commit = spawnSync('git', ['log', '-1', '--format=%cI'], { cwd: ROOT, encoding: 'utf8' })
  const text = (commit.stdout ?? '').trim()
  if (text !== '') {
    const parsed = new Date(text)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}
