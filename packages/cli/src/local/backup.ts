/**
 * 本地热备份：复用 storage 的 `VACUUM INTO` 实现，并在写入后校验完整性。
 */
import {
  backupDatabase,
  type BackupOptions,
  type BackupResult,
  type Database,
} from '@ledger/storage-sqlite'

/**
 * 生成一份一致性备份。
 * @param db 数据库连接
 * @param options 备份目录（缺省为数据库同级 backups/）
 * @returns 备份文件路径与字节数
 */
export function backupLedger(db: Database, options: BackupOptions = {}): BackupResult {
  return backupDatabase(db, options)
}
