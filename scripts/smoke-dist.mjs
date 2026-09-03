/**
 * 构建产物冒烟验证脚本
 *
 * 对四类产物做黑盒加载验证（不依赖浏览器环境）：
 * 1. ESM pure 产物：导出面完整性
 * 2. ESM 主产物：mock 播放器的入口组装级验证
 *    （customType 注册 / 句柄契约 / 无实例时的开关与调参语义 / destroy 幂等）
 * 3. CJS 主产物：require 互操作性 + 同一套组装断言
 * 4. IIFE 产物：全局自挂载
 *
 * 入口组装验证使用 { ui: false } 绕开 DOM（UI 行为由 demo 验收清单覆盖）；
 * mock 播放器仅提供入口流程触达的最小表面
 *
 * 结果输出到 output/smoke-dist-<时间戳>.json，进程自动退出
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const OUTPUT_DIR = 'output'

/** 断言记录（name / pass / detail），失败不中断，最终汇总判定 */
const assertions = []

/**
 * 记录一条断言
 *
 * @param {string} name 断言名称
 * @param {boolean} pass 断言结果
 * @param {unknown} detail 断言上下文数据
 */
function record(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: detail ?? null })
}

/**
 * 创建入口流程所需的最小 mock 播放器
 *
 * emit 记录派发事件，供 p2p:stateChange 事件断言使用
 *
 * @returns {{ art: Record<string, unknown>, customType: Record<string, unknown>, events: Array<[string, unknown[]]> }} 播放器、customType 表与事件流水
 */
function createMockArt() {
  const customType = {}
  const events = []
  const art = {
    option: { customType, url: '' },
    // 时序补救仅在有 option.url 且 src 为流地址时触达；提供空实现防越界
    template: {
      $video: { getAttribute: () => null, removeAttribute() {}, load() {} },
    },
    on() {},
    off() {},
    emit(name, ...args) {
      events.push([name, args])
    },
    notice: {},
  }
  return { art, customType, events }
}

/**
 * 入口组装级断言（ESM 与 CJS 共用）
 *
 * @param {string} label 断言前缀（区分模块格式）
 * @param {(options: Record<string, unknown>) => (art: Record<string, unknown>) => Record<string, unknown>} factory 插件工厂
 */
function testEntryAssembly(label, factory) {
  const { art, customType, events } = createMockArt()

  const pluginFunction = factory({ ui: false })
  record(`${label}: 工厂返回插件函数`, typeof pluginFunction === 'function', typeof pluginFunction)

  const handle = pluginFunction(art)
  record(`${label}: 句柄挂载键正确`, handle?.name === 'artplayerPluginP2P', handle?.name)
  record(`${label}: customType 已注册`, typeof customType.m3u8 === 'function', Object.keys(customType))

  const snapshot = handle.getStats()
  record(`${label}: getStats 返回初始快照`, snapshot.peers === 0 && snapshot.totalDownloadedBytes === 0 && snapshot.peakPeers === 0, snapshot)

  record(`${label}: 初始开关全开`, handle.isP2PEnabled() === true && handle.isUploadEnabled() === true, {
    p2p: handle.isP2PEnabled(),
    upload: handle.isUploadEnabled(),
  })

  // 无活跃实例时开关仅记录状态（待实例创建生效），调参静默，但仍派发状态变化事件
  handle.setP2PEnabled(false)
  handle.setUploadEnabled(false)
  record(`${label}: 无实例时开关仅记状态`, handle.isP2PEnabled() === false && handle.isUploadEnabled() === false, {
    p2p: handle.isP2PEnabled(),
    upload: handle.isUploadEnabled(),
  })
  const stateEvents = events.filter(([name]) => name === 'p2p:stateChange')
  record(`${label}: 开关切换各派发一次 p2p:stateChange`, stateEvents.length === 2, stateEvents.length)
  const [lastPayload] = stateEvents.at(-1)?.[1] ?? []
  record(
    `${label}: stateChange 负载与开关状态一致`,
    lastPayload?.p2pEnabled === false && lastPayload?.uploadEnabled === false,
    lastPayload,
  )
  handle.applyDynamicConfig({ httpDownloadTimeWindow: 60 })
  record(`${label}: 无实例时动态调参静默`, true)

  handle.setP2PEnabled(true)
  handle.setUploadEnabled(true)
  record(`${label}: 开关恢复`, handle.isP2PEnabled() === true && handle.isUploadEnabled() === true)

  handle.destroy()
  handle.destroy()
  record(`${label}: destroy 幂等`, true)
}

const startTime = Date.now()
try {
  const pure = await import('../dist/pure.mjs')
  record(
    'pure.mjs: 导出面完整',
    [
      'BANDWIDTH_WINDOW_MS',
      'DEFAULT_FATAL_RETRY_MAX',
      'DEFAULT_TYPE',
      'P2P_EVENT_BRIDGE_MAP',
      'STATS_POLLING_MS',
      'resolveOptions',
      'mergeCoreConfig',
      'applyRuntimeToggle',
      'BandwidthCalculator',
      'P2PStatsEngine',
    ].every(key => key in pure),
    Object.keys(pure).sort(),
  )
  record('pure.mjs: 默认类型名为 m3u8', pure.DEFAULT_TYPE === 'm3u8', pure.DEFAULT_TYPE)
  record(
    'pure.mjs: 事件映射表覆盖 15 个 Core 事件',
    Object.keys(pure.P2P_EVENT_BRIDGE_MAP ?? {}).length === 15,
    Object.keys(pure.P2P_EVENT_BRIDGE_MAP ?? {}).length,
  )

  const esm = await import('../dist/index.mjs')
  record('index.mjs: 默认导出为插件工厂', typeof esm.default === 'function', typeof esm.default)
  testEntryAssembly('index.mjs(ESM)', esm.default)

  const cjs = require('../dist/index.js')
  record('index.js(CJS): default 导出互操作为插件工厂', typeof cjs?.default === 'function', typeof cjs?.default)
  testEntryAssembly('index.js(CJS)', cjs.default)

  require('../dist/artplayer-plugin-p2p.iife.js')
  record('iife.js: 全局自挂载为可调用工厂', typeof globalThis.artplayerPluginP2P === 'function', typeof globalThis.artplayerPluginP2P)

  // 面板显隐与官方 class 解耦的规则必须进入交付产物（回归防护：
  // 缺失时官方 .art-info-show 联动会强制显示 P2P 面板且无法关闭）
  const iifeSource = readFileSync(
    fileURLToPath(new URL('../dist/artplayer-plugin-p2p.iife.js', import.meta.url)),
    'utf8',
  )
  record(
    'iife.js: 面板显隐解耦规则存在',
    iifeSource.includes('artp2p-stats-show') && iifeSource.includes('art-info.artp2p-info'),
    {
      hasShowClass: iifeSource.includes('artp2p-stats-show'),
      hasDecoupledSelector: iifeSource.includes('art-info.artp2p-info'),
    },
  )
} catch (error) {
  record('执行过程发生未捕获异常', false, String(error?.stack ?? error))
}

const failed = assertions.filter(item => !item.pass)
const report = {
  timestamp: new Date().toISOString(),
  nodeVersion: process.version,
  total: assertions.length,
  passed: assertions.length - failed.length,
  failed: failed.length,
  verdict: failed.length === 0 ? 'PASS: 构建产物冒烟通过' : 'FAIL: 存在失败断言',
  assertions,
  elapsedMs: Date.now() - startTime,
}

mkdirSync(OUTPUT_DIR, { recursive: true })
const outputPath = join(OUTPUT_DIR, `smoke-dist-${Date.now()}.json`)
writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')

console.log(`\n===== 构建产物冒烟 =====`)
console.log(`通过 ${report.passed}/${report.total}，耗时 ${report.elapsedMs}ms`)
for (const item of assertions) {
  console.log(`${item.pass ? '✓' : '✗'} ${item.name}`)
}
console.log(`结果已写入: ${outputPath}`)
console.log(`结论: ${report.verdict}`)

// 有界退出：断言失败以非零码结束，便于 CI 与脚本链路感知
process.exit(failed.length === 0 ? 0 : 1)
