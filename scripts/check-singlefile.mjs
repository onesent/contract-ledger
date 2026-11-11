#!/usr/bin/env node
/**
 * 单文件构建产物自包含校验。
 * 用法：npm run build && npm run check
 * 失败时以非零退出码退出，并逐条列出原因。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIST = join(process.cwd(), 'dist')
const HTML = join(DIST, 'index.html')
const MAX_BYTES = 5 * 1024 * 1024

const results = []
/** @param {string} name @param {boolean} ok @param {string} [detail] */
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
}

/** @param {number} bytes */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 递归列出 dist 下所有文件（相对路径）。 */
function walk(dir) {
  /** @type {string[]} */
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (entry.isFile()) files.push(relative(DIST, full).split('\\').join('/'))
  }
  return files
}

let html = ''
let size = 0

if (!existsSync(DIST)) {
  console.error('✗ dist/ 目录不存在，请先运行 npm run build')
  process.exit(1)
}
if (!existsSync(HTML)) {
  console.error('✗ dist/index.html 不存在，构建未产出单文件产物')
  process.exit(1)
}

size = statSync(HTML).size
html = readFileSync(HTML, 'utf8')

check('dist/index.html 存在', true, formatSize(size))

// 1) dist 下除 index.html 外无其它文件
const files = walk(DIST)
const extra = files.filter((file) => file !== 'index.html')
check(
  'dist/ 仅包含 index.html（无 assets/、无 .css/.js/.svg 残留）',
  extra.length === 0,
  extra.length === 0 ? '' : `多余文件：${extra.slice(0, 10).join(', ')}${extra.length > 10 ? ' …' : ''}`,
)

// 2) 无外链 script / stylesheet
const scriptSrc = [...html.matchAll(/<script\b[^>]*\bsrc\s*=/gi)]
const linkStylesheet = [...html.matchAll(/<link\b[^>]*\brel\s*=\s*["']?stylesheet/gi)]
const linkHref = [...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)]
const externalLinkHref = linkHref.filter((match) => /^(https?:)?\/\//i.test(match[1]))
check('无 <script src=...> 外链脚本', scriptSrc.length === 0, scriptSrc.length ? `发现 ${scriptSrc.length} 处` : '')
check(
  '无 <link rel="stylesheet" href=...> 外部样式',
  linkStylesheet.length === 0 && externalLinkHref.length === 0,
  linkStylesheet.length || externalLinkHref.length
    ? `发现 stylesheet ${linkStylesheet.length} 处、外链 link ${externalLinkHref.length} 处`
    : '',
)

// 3) 无外链资源（脚本 / 样式 / 图片 / 字体 / favicon / CDN）
const externalPatterns = [
  { name: '<script src> 外链', regex: /<script\b[^>]*\bsrc\s*=\s*["']?https?:\/\//gi },
  { name: '<link href> 外链', regex: /<link\b[^>]*\bhref\s*=\s*["']?https?:\/\//gi },
  { name: '<img src> 外链', regex: /<img\b[^>]*\bsrc\s*=\s*["']?https?:\/\//gi },
  { name: 'iframe / source / video 外链', regex: /<(?:iframe|source|video|audio)\b[^>]*\b(?:src|poster)\s*=\s*["']?https?:\/\//gi },
  { name: 'CSS url() 外链', regex: /url\(\s*["']?https?:\/\//gi },
  { name: 'CSS @import 外链', regex: /@import\s+(?:url\()?["']?https?:\/\//gi },
  { name: 'CDN / 外链字体域名', regex: /(?:cdn\.|cdnjs|unpkg\.com|jsdelivr|fonts\.googleapis|fonts\.gstatic|at\.alicdn)/gi },
]
const externalHits = []
for (const pattern of externalPatterns) {
  const matches = html.match(pattern.regex)
  if (matches && matches.length) externalHits.push(`${pattern.name} × ${matches.length}`)
}
check(
  '无任何外链 http(s) 资源引用（字体内联、图标内联、无 favicon 外链）',
  externalHits.length === 0,
  externalHits.join('；'),
)

// 4) Element Plus 样式确实内联
const hasElementStyle = /--el-color-primary/.test(html) || /\.el-button/.test(html)
check(
  'Element Plus 样式已内联（--el-color-primary / .el-button）',
  hasElementStyle,
  hasElementStyle ? '' : '未找到 Element Plus 样式特征，检查 ElementPlusResolver 的 importStyle 配置',
)

// 5) hash 路由标识 + AI provider 标识
const hasHashRoute =
  /createWebHashHistory/.test(html) || /#\/home|#\/contracts|#\/settings/.test(html) || /["']\/home["']/.test(html)
const hasAiProvider = /not-configured|extractContract|askLedger|draftReminder/.test(html)
check('包含 hash 路由标识', hasHashRoute, hasHashRoute ? '' : '未找到 createWebHashHistory / #/home 等标识')
check(
  '包含 AI provider 标识（未配置占位实现）',
  hasAiProvider,
  hasAiProvider ? '' : '未找到 provider.js 的标识字符串',
)

// 6) 体积
check(
  `dist/index.html 体积 ≤ 5 MB（实测 ${formatSize(size)}）`,
  size <= MAX_BYTES,
  size <= MAX_BYTES ? '' : '超出体积上限',
)

// 7) 统计内联资源
const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>/gi)].length
const inlineStyles = [...html.matchAll(/<style\b[^>]*>/gi)].length

console.log('')
console.log('==============================')
console.log('单文件产物校验报告')
console.log('==============================')
console.log(`dist/index.html：${formatSize(size)}（${size} 字节）`)
console.log(`内联 <script>：${inlineScripts} 个；内联 <style>：${inlineStyles} 个`)
console.log(`dist/ 文件数：${files.length}（${files.join(', ')}）`)
console.log('------------------------------')
let failed = 0
for (const item of results) {
  console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
  if (!item.ok) failed += 1
}
console.log('------------------------------')

if (failed > 0) {
  console.error(`\n校验失败：${failed} 项未通过。`)
  if (size > MAX_BYTES) {
    console.error('降体积建议：')
    console.error('  1. 确认未全量引入 element-plus（不要 app.use(ElementPlus) 与全量 CSS）')
    console.error('  2. 确认未 import * as echarts from "echarts"，只从 src/utils/echarts.js 按需注册')
    console.error('  3. 确认 dependencies 未额外引入 UI / 图表 / 工具库')
    console.error('  4. 检查 vite.config.js 是否启用 viteSingleFile({ useRecommendedBuildConfig: true })')
  }
  process.exit(1)
}

console.log('\n全部断言通过：产物为单一自包含 index.html。')
