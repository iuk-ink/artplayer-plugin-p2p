/**
 * README 文档一致性测试脚本
 *
 * 将 README 视为可测试夹具：从文档表格提取选项 / 句柄 / 工厂
 * 静态成员名，与 d.ts 声明做双向断言——文档漂移从此是测试失败
 * 而非用户报告
 *
 * 前置条件：先执行 npm run build 生成 dist（d.ts 为提取源）
 * 结果输出到 output/test-docs-<时间戳>.json，进程自动退出
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const OUTPUT_DIR = 'output'
const assertions = []

function record(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: detail ?? null })
}

const readme = readFileSync('README.md', 'utf8')

// 合并全部 d.ts 声明（共享 chunk 中的 interface 定义一并纳入）
const distDir = 'dist'
const dtsFiles = readdirSync(distDir).filter(file => file.endsWith('.d.ts'))
const dts = dtsFiles.map(file => readFileSync(join(distDir, file), 'utf8')).join('\n')

/** 截取 README 中 start 标题到 end 标题（或文末）之间的内容 */
function section(start, end) {
  const startIndex = readme.indexOf(start)
  if (startIndex === -1) return ''
  const endIndex = end === undefined ? readme.length : readme.indexOf(end, startIndex)
  return readme.slice(startIndex, endIndex === -1 ? readme.length : endIndex)
}

/**
 * 提取 markdown 表格首列的成员名
 *
 * - firstOnly：仅取行首第一段（选项表说明列含反引号代码词，须避免误提取）
 * - 全段模式：说明列无反引号内容的表（句柄表）提取行内全部段
 */
function extractTableMembers(sectionText, { allSegments = false } = {}) {
  const members = []
  for (const line of sectionText.matchAll(/^\| (.+)$/gm)) {
    const segs = [...line[1].matchAll(/`([^`]+)`/g)].map(match => match[1])
    for (const seg of allSegments ? segs : segs.slice(0, 1)) {
      for (const part of seg.split('/')) {
        members.push(part.trim().replace(/\(.*\)$/, ''))
      }
    }
  }
  return members
}

/** 提取 d.ts 中指定 interface 块的成员名（跳过注释行；方法签名含嵌套括号亦可提取） */
function extractInterfaceMembers(name) {
  const match = dts.match(new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n\\}`))
  if (!match) return null
  const members = []
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) continue
    const member = line.match(/^\s{2}(?:readonly )?(\w+)/)
    if (member && line.includes(':')) members.push(member[1])
  }
  return members
}

/** 集合双向相等断言（附差集明细） */
function recordSetEqual(name, docKeys, dtsKeys) {
  const docSet = [...new Set(docKeys)]
  const dtsSet = [...new Set(dtsKeys)]
  const missingInDts = docSet.filter(key => !dtsSet.includes(key))
  const missingInDocs = dtsSet.filter(key => !docSet.includes(key))
  record(name, missingInDts.length === 0 && missingInDocs.length === 0, { missingInDts, missingInDocs })
}

// --- 选项表 ↔ P2POptions ---
const optionsDoc = extractTableMembers(section('### 插件选项', '### UI 选项'))
const optionsDts = extractInterfaceMembers('P2POptions')
if (optionsDts === null) {
  record('选项表: d.ts 中存在 P2PPluginOptions 声明', false, 'P2POptions not found')
} else {
  recordSetEqual('选项表 ↔ P2POptions 双向一致', optionsDoc, optionsDts)
}

// --- 句柄表 ↔ P2PPluginHandle（说明列无反引号内容，行内全段提取） ---
const handleDoc = extractTableMembers(section('## 插件句柄', '## 事件'), { allSegments: true })
const handleDts = extractInterfaceMembers('P2PPluginHandle')
if (handleDts === null) {
  record('句柄表: d.ts 中存在 P2PPluginHandle 声明', false, 'P2PPluginHandle not found')
} else {
  recordSetEqual('句柄表 ↔ P2PPluginHandle 双向一致', handleDoc, handleDts)
}

// --- 示例 handle 成员引用 ↔ P2PPluginHandle ---
// 示例代码中 handle.method 调用必须是 d.ts 已声明成员；
// 选项名不纳入此断言（示例非类型消费面，选项一致性由选项表断言保障）
if (handleDts !== null && existsSync('examples')) {
  const referenced = []
  for (const file of readdirSync('examples').filter(item => item.endsWith('.html'))) {
    const html = readFileSync(join('examples', file), 'utf8')
    for (const match of html.matchAll(/handle\.(\w+)/g)) {
      referenced.push(match[1])
    }
  }
  const unique = [...new Set(referenced)]
  const unknown = unique.filter(name => !handleDts.includes(name))
  record('示例 handle 成员引用 ↔ P2PPluginHandle 一致', unknown.length === 0, { referenced: unique, unknown })
}

// --- 工厂静态成员 ↔ P2PPluginFactory ---
const factoryDoc = [...readme.matchAll(/artplayerPluginP2P\.(version|DEBUG)/g)].map(match => match[1])
const factoryDts = extractInterfaceMembers('P2PPluginFactory')
if (factoryDts === null) {
  record('静态成员: d.ts 中存在 P2PPluginFactory 声明', false, 'P2PPluginFactory not found')
} else {
  recordSetEqual('静态成员 ↔ P2PPluginFactory 双向一致', factoryDoc, factoryDts)
}

// --- 入口 d.ts 的导出面不含内部类型 ---
// （内部类型会以非导出声明的形式存在于共享 chunk，属正常；入口导出语句不得外泄）
const entryDts = readFileSync('dist/index.d.ts', 'utf8')
record('入口 d.ts 导出面不含内部类型 ResolvedOptions', !entryDts.includes('ResolvedOptions'))
record('入口 d.ts 导出面不含内部类型 EngineOptions', !entryDts.includes('EngineOptions'))

const failed = assertions.filter(item => !item.pass)
const report = {
  timestamp: new Date().toISOString(),
  nodeVersion: process.version,
  total: assertions.length,
  passed: assertions.length - failed.length,
  failed: failed.length,
  verdict: failed.length === 0 ? 'PASS: README 一致性断言通过' : 'FAIL: 存在失败断言',
  assertions,
}

mkdirSync(OUTPUT_DIR, { recursive: true })
const outputPath = join(OUTPUT_DIR, `test-docs-${Date.now()}.json`)
writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')

console.log(`\n===== README 一致性断言 =====`)
console.log(`通过 ${report.passed}/${report.total}`)
for (const item of assertions) {
  console.log(`${item.pass ? '✓' : '✗'} ${item.name}`)
}
console.log(`结果已写入: ${outputPath}`)
console.log(`结论: ${report.verdict}`)

process.exit(failed.length === 0 ? 0 : 1)
