import { describe, expect, it } from 'vitest'
import { assertRuntime, loadBetterSqlite3 } from './check-runtime.mjs'

describe('assertRuntime', () => {
  it('Node.js 低于 24.0.0 时抛出中文可操作错误', () => {
    expect(() => assertRuntime({ nodeVersion: '23.11.1', sqliteVersion: '3.53.4' })).toThrow(/Node\.js 版本过低/)
  })

  it('SQLite 低于 3.51.3 时抛出中文可操作错误', () => {
    expect(() => assertRuntime({ nodeVersion: '24.9.0', sqliteVersion: '3.51.2' })).toThrow(/SQLite 版本过低/)
  })

  it('恰好达到最低版本边界时通过', () => {
    expect(() => assertRuntime({ nodeVersion: '24.0.0', sqliteVersion: '3.51.3' })).not.toThrow()
  })

  it('当前运行时通过版本断言', () => {
    const Database = loadBetterSqlite3()
    const db = new Database(':memory:')
    const row = db.prepare('SELECT sqlite_version() AS version').get()
    db.close()
    expect(() => assertRuntime({ sqliteVersion: String(row.version) })).not.toThrow()
  })
})
