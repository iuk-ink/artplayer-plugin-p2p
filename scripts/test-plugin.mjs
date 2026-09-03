/**
 * 聚合测试入口：顺序执行三套自动化验证并汇总报告
 *
 * 1. pure 层单元测试（选项解析 / 降级兼容 / 统计引擎 / 带宽）
 * 2. 构建产物冒烟（ESM / CJS / IIFE 加载与入口组装断言）
 * 3. 无损动态切换验证（Core 直连 + 引擎转发路径）
 *
 * 任一套失败即整体失败（非零退出）；汇总报告输出到
 * output/test-plugin-<时间戳>.json，进程自动退出
 *
 * 前置条件：先执行 npm run build 生成 dist
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const OUTPUT_DIR = 'output'

/** 依次执行的验证套件（Node 参数与脚本路径） */
const SUITES = [
  { name: 'pure 单元测试', args: ['scripts/test-pure.mjs'] },
  { name: '构建产物冒烟', args: ['--conditions=p2pml:core-as-bundle', 'scripts/smoke-dist.mjs'] },
]

/**
 * 以子进程执行单个验证套件
 *
 * @param {{ name: string, args: string[] }} suite 验证套件
 * @returns {Promise<{ name: string, exitCode: number, output: string }>} 执行结果
 */
function runSuite(suite) {
  return new Promise((resolveSuite) => {
    const child = spawn(process.execPath, suite.args, { cwd: process.cwd() })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      process.stderr.write(chunk)
    })
    child.on('close', (exitCode) => {
      resolveSuite({ name: suite.name, exitCode: exitCode ?? -1, output })
    })
    child.on('error', (error) => {
      resolveSuite({ name: suite.name, exitCode: -1, output: String(error) })
    })
  })
}

const startTime = Date.now()
const results = []
for (const suite of SUITES) {
  console.log(`\n===== ${suite.name} =====`)
  const result = await runSuite(suite)
  results.push(result)
  if (result.exitCode !== 0) {
    console.error(`\n套件「${suite.name}」失败，终止后续套件`)
    break
  }
}

const failed = results.filter(result => result.exitCode !== 0)
const report = {
  timestamp: new Date().toISOString(),
  nodeVersion: process.version,
  suites: results.map(result => ({ name: result.name, exitCode: result.exitCode, passed: result.exitCode === 0 })),
  total: SUITES.length,
  ran: results.length,
  failed: failed.length,
  verdict: failed.length === 0 ? 'PASS: 全部验证通过' : `FAIL: ${failed.map(result => result.name).join('、')} 失败`,
  elapsedMs: Date.now() - startTime,
}

mkdirSync(OUTPUT_DIR, { recursive: true })
const outputPath = join(OUTPUT_DIR, `test-plugin-${Date.now()}.json`)
writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')

console.log(`\n===== 聚合测试汇总 =====`)
console.log(`套件 ${SUITES.length - failed.length}/${SUITES.length} 通过，耗时 ${report.elapsedMs}ms`)
for (const result of results) {
  console.log(`${result.exitCode === 0 ? '✓' : '✗'} ${result.name}`)
}
console.log(`汇总已写入: ${outputPath}`)
console.log(`结论: ${report.verdict}`)

process.exit(failed.length === 0 ? 0 : 1)
