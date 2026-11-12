/**
 * 数据导出：直接复用 storage 的 `exportDataset`（settings 已剔除密钥），
 * 可选地把结果写入 JSON 文件并返回文件信息。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { exportDataset, type Database, type DatasetExport } from '@ledger/storage-sqlite'

/** 导出文件落盘结果。 */
export interface ExportFileResult {
  /** 写入的绝对路径。 */
  path: string
  /** 文件字节数。 */
  bytes: number
  /** 各集合记录数。 */
  counts: ExportCounts
}

/** 导出集合记录数。 */
export interface ExportCounts {
  contracts: number
  payments: number
  deliveries: number
  personnel: number
  dicts: number
}

/** 导出选项。 */
export interface ExportOptions {
  /** 输出文件路径；缺省时仅返回数据集对象。 */
  out?: string
}

/**
 * 统计导出数据集各集合的记录数。
 * @param dataset 导出数据集
 * @returns 记录数
 */
function countDataset(dataset: DatasetExport): ExportCounts {
  return {
    contracts: dataset.data.contracts.length,
    payments: dataset.data.payments.length,
    deliveries: dataset.data.deliveries.length,
    personnel: dataset.data.personnel.length,
    dicts: dataset.data.dicts.length,
  }
}

/**
 * 导出数据集；提供 `out` 时以两空格缩进写入文件（自动创建目录）。
 * @param db 数据库连接
 * @param options 输出文件路径
 * @returns 无 `out` 时返回数据集；有 `out` 时返回路径、字节数与记录数
 */
export async function exportLedger(
  db: Database,
  options: ExportOptions = {},
): Promise<DatasetExport | ExportFileResult> {
  const dataset = exportDataset(db)
  if (options.out === undefined) {
    return dataset
  }

  const target = path.resolve(options.out)
  await mkdir(path.dirname(target), { recursive: true })
  const text = `${JSON.stringify(dataset, null, 2)}\n`
  await writeFile(target, text, 'utf8')
  return {
    path: target,
    bytes: Buffer.byteLength(text, 'utf8'),
    counts: countDataset(dataset),
  }
}
