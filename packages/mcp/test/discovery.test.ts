import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeCore } from '@ledger/core'
import { buildToolDefs } from '@ledger/mcp'
import {
  buildArtifacts,
  createRegistry,
  writeArtifacts,
} from '../scripts/generate-discovery.mjs'
import { createTestRegistry } from './fixtures.js'

/**
 * 把未知值收敛成普通对象。
 * @param value 任意值
 * @returns 普通对象；非对象返回 null
 */
function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return Object.fromEntries(Object.entries(value))
}

/**
 * 解析 commands.json。
 * @param text JSON 文本
 * @returns schemaVersion 与命令数组
 */
function parseCommandsJson(text: string): {
  schemaVersion: unknown
  commands: Record<string, unknown>[]
} {
  const record = toRecord(JSON.parse(text))
  const commands: Record<string, unknown>[] = []
  const rawCommands = record?.commands
  if (Array.isArray(rawCommands)) {
    for (const item of rawCommands) {
      const command = toRecord(item)
      if (command !== null) commands.push(command)
    }
  }
  return { schemaVersion: record?.schemaVersion, commands }
}

describe('generate-discovery', () => {
  it('同一注册表重复生成得到完全一致的 commands.json', () => {
    const registry = createTestRegistry()
    const first = buildArtifacts(registry)
    const second = buildArtifacts(registry)

    expect(second.commandsJson).toBe(first.commandsJson)
    expect(second.agentsMarkdown).toBe(first.agentsMarkdown)
    expect(second.llmsTxt).toBe(first.llmsTxt)
  })

  it('commands.json 的命令与 toolName 和工具定义、core describe 版本一致', () => {
    const registry = createTestRegistry()
    const parsed = parseCommandsJson(buildArtifacts(registry).commandsJson)
    const tools = buildToolDefs(registry)

    expect(parsed.schemaVersion).toBe(describeCore().schemaVersion)
    expect(parsed.commands.map((command) => command.name)).toEqual(
      tools.map((tool) => tool.commandName),
    )
    expect(parsed.commands.map((command) => command.toolName)).toEqual(
      tools.map((tool) => tool.name),
    )
    const knownCodes = new Set(describeCore().errorCodes.map((entry) => entry.code))
    for (const command of parsed.commands) {
      expect(command.annotations).toBeDefined()
      expect(command.inputSchema).toBeDefined()
      expect(command.outputSchema).toBeDefined()
      const errorCodes = command.errorCodes
      expect(Array.isArray(errorCodes)).toBe(true)
      if (Array.isArray(errorCodes)) {
        for (const code of errorCodes) {
          if (typeof code === 'string') expect(knownCodes.has(code)).toBe(true)
        }
      }
    }
  })

  it('写入目录两次产生逐字节一致的 commands.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ledger-discovery-'))
    try {
      const artifacts = buildArtifacts(createTestRegistry())
      await writeArtifacts(root, artifacts)
      const first = await readFile(path.join(root, 'schema', 'commands.json'), 'utf8')
      await writeArtifacts(root, artifacts)
      const second = await readFile(path.join(root, 'schema', 'commands.json'), 'utf8')

      expect(second).toBe(first)
      expect(second).toBe(artifacts.commandsJson)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('core 已导出 registerCoreCommands 时使用真实命令，否则保持空注册表', async () => {
    const coreModule = toRecord(await import('@ledger/core'))
    const registerCoreCommands = coreModule?.registerCoreCommands

    if (typeof registerCoreCommands === 'function') {
      const registry = createRegistry()
      const tools = buildToolDefs(registry)
      expect(tools.length).toBeGreaterThan(0)
      for (const tool of tools) {
        expect(registry.get(tool.commandName)).not.toBeNull()
      }
    } else {
      expect(createRegistry().list()).toHaveLength(0)
    }
  })
})
