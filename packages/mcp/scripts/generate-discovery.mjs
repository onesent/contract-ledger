/**
 * 生成能力发现产物：schema/commands.json、docs/AGENTS.ledger.md、llms.txt。
 * 运行前必须先构建（npm run build -w @ledger/mcp）；输出仅取决于注册表，可重复执行。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as core from '@ledger/core'
import { buildToolDefs, renderDiscoveryArtifacts } from '@ledger/mcp'

/** 包根目录（packages/mcp）。 */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 产物相对路径。 */
const OUTPUT_PATHS = {
  commandsJson: path.join('schema', 'commands.json'),
  agentsMarkdown: path.join('docs', 'AGENTS.ledger.md'),
  llmsTxt: 'llms.txt',
}

/**
 * 构造注册表：core 导出 registerCoreCommands 时使用真实命令，否则保持空表。
 * @returns 命令注册表
 */
export function createRegistry() {
  const registry = new core.CommandRegistry()
  const module = core
  if (typeof module.registerCoreCommands === 'function') {
    module.registerCoreCommands(registry)
  }
  return registry
}

/**
 * 由注册表生成三个发现产物的内容。
 * @param {import('@ledger/core').CommandRegistry} registry 命令注册表
 * @returns {{ commandsJson: string, agentsMarkdown: string, llmsTxt: string }}
 */
export function buildArtifacts(registry) {
  const schemaVersion =
    typeof core.describeCore === 'function' ? core.describeCore().schemaVersion : 3
  return renderDiscoveryArtifacts(buildToolDefs(registry), { schemaVersion })
}

/**
 * 把产物写入指定根目录；重复写入字节完全一致。
 * @param {string} root 目标根目录
 * @param {{ commandsJson: string, agentsMarkdown: string, llmsTxt: string }} artifacts 产物内容
 * @returns {Promise<string[]>} 写入的相对路径列表
 */
export async function writeArtifacts(root, artifacts) {
  const entries = [
    [OUTPUT_PATHS.commandsJson, artifacts.commandsJson],
    [OUTPUT_PATHS.agentsMarkdown, artifacts.agentsMarkdown],
    [OUTPUT_PATHS.llmsTxt, artifacts.llmsTxt],
  ]
  const written = []
  for (const [relativePath, content] of entries) {
    const target = path.join(root, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
    written.push(relativePath)
  }
  return written
}

/**
 * 默认生成流程：读取 core 注册表并写入包根目录。
 * @returns {Promise<string[]>} 写入的相对路径列表
 */
export async function runGenerator() {
  return writeArtifacts(PACKAGE_ROOT, buildArtifacts(createRegistry()))
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (invokedDirectly) {
  runGenerator()
    .then((written) => {
      process.stdout.write(`已生成发现产物：${written.join(', ')}\n`)
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`生成发现产物失败：${message}\n`)
      process.exitCode = 1
    })
}
