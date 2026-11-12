/**
 * 启动参数：只允许回环监听，端口与数据目录可配置。
 */
import { describe, expect, it } from 'vitest'
import { main, resolveServerOptions } from '../src/main.js'
import { resolveBuildInfo } from '../src/build-info.js'

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

  it('解析 --web-dir，未提供时不托管页面', () => {
    expect(resolveServerOptions([]).webDir).toBeUndefined()
    const options = resolveServerOptions(['--web-dir', 'packages/web/dist'])
    expect(options.webDir).toBe('packages/web/dist')
  })

  it('--version 只打印版本并返回，不启动服务', async () => {
    const chunks: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write
    try {
      await main(['--version'])
    } finally {
      process.stdout.write = original
    }
    expect(chunks.join('')).toContain(resolveBuildInfo().version)
  })
})
