/**
 * 启动参数：只允许回环监听，端口与数据目录可配置。
 */
import { describe, expect, it } from 'vitest'
import { resolveServerOptions } from '../src/main.js'

describe('启动参数', () => {
  it('默认只监听回环地址并使用默认端口', () => {
    const options = resolveServerOptions([])
    expect(options.host).toBe('127.0.0.1')
    expect(options.port).toBe(4517)
  })

  it('拒绝非回环 --host', () => {
    expect(() => resolveServerOptions(['--host', '0.0.0.0'])).toThrow(/回环/)
    expect(() => resolveServerOptions(['--host', '192.168.1.10'])).toThrow(/回环/)
  })

  it('接受回环 host 与合法端口', () => {
    const options = resolveServerOptions(['--host', 'localhost', '--port', '4600', '--data', 'tmp'])
    expect(options.host).toBe('localhost')
    expect(options.port).toBe(4600)
    expect(options.dataDir).toBe('tmp')
  })

  it('拒绝非法端口', () => {
    expect(() => resolveServerOptions(['--port', '0'])).toThrow(/--port 必须是/)
    expect(() => resolveServerOptions(['--port', '70000'])).toThrow(/--port 必须是/)
  })
})
