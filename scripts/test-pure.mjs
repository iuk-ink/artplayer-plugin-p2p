/**
 * pure 层单元测试脚本
 *
 * 覆盖无浏览器依赖的核心逻辑：
 * 1. resolveOptions：默认值填充与 stats / ui / badge 降级兼容矩阵
 * 2. 场景预设：preset 展开 / 用户 core 覆盖优先 / 未知名静默忽略
 * 3. mergeCoreConfig：core 与 tracker 浅合并优先级
 * 4. applyRuntimeToggle：运行时开关对 core 同名字段的接管语义
 * 5. P2PStatsEngine：分类累加 / 非负保护 / 派生指标 / 重置语义
 * 6. BandwidthCalculator：滑动窗口速率与过期清理
 * 7. 事件映射表：键数量与前缀约定（类型穷尽性由编译期 satisfies 保证）
 *
 * 结果输出到 output/test-pure-<时间戳>.json，进程自动退出
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  P2P_EVENT_BRIDGE_MAP,
  DEFAULT_TYPE,
  DEFAULT_FATAL_RETRY_MAX,
  BANDWIDTH_WINDOW_MS,
  resolveOptions,
  mergeCoreConfig,
  applyRuntimeToggle,
  applyScenePreset,
  BandwidthCalculator,
  P2PStatsEngine,
} from '../dist/pure.mjs'

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
 * 深度断言解析结果中指定字段的取值
 *
 * @param {string} name 断言名称
 * @param {Record<string, unknown>} resolved 解析结果
 * @param {Record<string, unknown>} expected 期望字段值
 */
function recordFields(name, resolved, expected) {
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => resolved[key] !== value)
    .map(([key, value]) => `${key}: 期望 ${String(value)}，实际 ${String(resolved[key])}`)
  record(name, mismatches.length === 0, mismatches)
}

/** resolveOptions：默认值与 stats / ui / badge 降级兼容矩阵 */
function testResolveOptions() {
  const defaults = resolveOptions({})
  recordFields('resolve: 全默认', defaults, {
    typeName: DEFAULT_TYPE,
    fatalRetryMax: DEFAULT_FATAL_RETRY_MAX,
    fatalNotice: false,
    p2pEnabled: true,
    uploadEnabled: true,
    uiEnabled: true,
    statsEnabled: true,
    badgeEnabled: false,
    settingEnabled: true,
  })

  const toggles = resolveOptions({ enabled: false, uploadEnabled: false })
  recordFields('resolve: 初始关闭 P2P 与上传', toggles, { p2pEnabled: false, uploadEnabled: false })

  const custom = resolveOptions({ type: 'm3u8p', fatalRetryMax: 5 })
  recordFields('resolve: 自定义格式名与重建上限', custom, { typeName: 'm3u8p', fatalRetryMax: 5 })

  const fatalNoticeOn = resolveOptions({ fatalNotice: true })
  recordFields('resolve: fatalNotice 显式开启', fatalNoticeOn, { fatalNotice: true })

  const fatalNoticeStrict = resolveOptions({ fatalNotice: 1 })
  recordFields('resolve: fatalNotice 非布尔真值不开启', fatalNoticeStrict, { fatalNotice: false })

  const uiFalse = resolveOptions({ ui: false })
  recordFields('resolve: ui=false 总闸全关', uiFalse, {
    uiEnabled: false,
    statsEnabled: false,
    badgeEnabled: false,
    settingEnabled: false,
  })

  const uiSettingOff = resolveOptions({ ui: { setting: false } })
  recordFields('resolve: 对象形式仅关设置组', uiSettingOff, {
    uiEnabled: true,
    statsEnabled: true,
    badgeEnabled: false,
    settingEnabled: false,
  })

  const statsOff = resolveOptions({ stats: false })
  recordFields('resolve: stats=false 仅关统计展示', statsOff, {
    uiEnabled: true,
    statsEnabled: false,
    badgeEnabled: false,
    settingEnabled: true,
  })

  const gatePriority = resolveOptions({ ui: false, stats: true })
  recordFields('resolve: ui 总闸优先于 stats', gatePriority, { uiEnabled: false, statsEnabled: false })

  const itemsPartial = resolveOptions({ ui: { setting: { p2pEnabled: false } } })
  recordFields('resolve: setting 细粒度隐藏单项', itemsPartial.settingItems, {
    p2pEnabled: false,
    uploadOnly: true,
    stats: true,
  })

  const itemsAll = resolveOptions({ ui: { setting: true } })
  recordFields('resolve: setting=true 三项全显', itemsAll.settingItems, {
    p2pEnabled: true,
    uploadOnly: true,
    stats: true,
  })

  const itemsOff = resolveOptions({ ui: { setting: false } })
  recordFields('resolve: setting=false 单项全隐', itemsOff.settingItems, {
    p2pEnabled: false,
    uploadOnly: false,
    stats: false,
  })

  const itemsDefault = resolveOptions({})
  recordFields('resolve: 省略 setting 时三项全显', itemsDefault.settingItems, {
    p2pEnabled: true,
    uploadOnly: true,
    stats: true,
  })

  const itemsUiOff = resolveOptions({ ui: false })
  recordFields('resolve: ui 总闸关闭时单项全隐', itemsUiOff.settingItems, {
    p2pEnabled: false,
    uploadOnly: false,
    stats: false,
  })

  // 场景预设：展开 / 覆盖优先级 / 透传边界
  const presetLive = resolveOptions({ preset: 'live' })
  recordFields('preset: live 展开推荐参数', presetLive.core ?? {}, {
    highDemandTimeWindow: 30,
    p2pDownloadTimeWindow: 8000,
  })

  const presetVod = resolveOptions({ preset: 'vod' })
  recordFields('preset: vod 展开推荐参数', presetVod.core ?? {}, {
    highDemandTimeWindow: 60,
    httpDownloadTimeWindow: 5000,
  })

  const presetOverride = resolveOptions({ preset: 'live', core: { highDemandTimeWindow: 10 } })
  recordFields('preset: 用户 core 同名字段覆盖预设', presetOverride.core ?? {}, {
    highDemandTimeWindow: 10,
    p2pDownloadTimeWindow: 8000,
  })

  const presetMerge = resolveOptions({ preset: 'vod', core: { swarmId: 'sw-1' } })
  recordFields('preset: 用户 core 异名字段与预设并存', presetMerge.core ?? {}, {
    swarmId: 'sw-1',
    highDemandTimeWindow: 60,
  })

  const noPreset = resolveOptions({ core: { highDemandTimeWindow: 15 } })
  recordFields('preset: 省略时 core 原样透传', noPreset.core ?? {}, { highDemandTimeWindow: 15 })

  const unknownPreset = applyScenePreset('invalid', { swarmId: 'sw-2' })
  record('preset: 未知名静默忽略保持原配置', unknownPreset !== undefined && unknownPreset.swarmId === 'sw-2' && unknownPreset.highDemandTimeWindow === undefined, unknownPreset)

  const bothEmpty = applyScenePreset(undefined, undefined)
  record('preset: 无预设无配置保持 undefined', bothEmpty === undefined, bothEmpty)
}

/** resolveOptions：badge 徽章选项解析与门控 */
function testResolveBadge() {
  const defaults = resolveOptions({})
  recordFields('badge: 默认关闭', defaults, { badgeEnabled: false })

  const badgeOn = resolveOptions({ badge: true })
  recordFields('badge: true 时初始显示', badgeOn, { badgeEnabled: true })

  const badgeOff = resolveOptions({ badge: false })
  recordFields('badge: false 显式关闭', badgeOff, { badgeEnabled: false })

  const uiOff = resolveOptions({ badge: true, ui: false })
  recordFields('badge: ui 总闸压过 badge', uiOff, { badgeEnabled: false })

  const statsOff = resolveOptions({ badge: true, stats: false })
  recordFields('badge: stats 总闸压过 badge', statsOff, { badgeEnabled: false })

  const settingOff = resolveOptions({ badge: true, ui: { setting: false } })
  recordFields('badge: ui.setting 不影响 badge', settingOff, { badgeEnabled: true })
}

/** mergeCoreConfig：core 与 tracker 浅合并优先级 */
function testMergeCoreConfig() {
  const empty = mergeCoreConfig({})
  record('merge: 空配置返回空对象（保持官方默认）', Object.keys(empty).length === 0, empty)

  const merged = mergeCoreConfig({
    core: { swarmId: 'swarm-a', highDemandTimeWindow: 30, rtcConfig: { iceServers: [{ urls: 'stun:a' }] } },
    tracker: { announceTrackers: ['wss://tracker.example.com'], rtcConfig: { iceServers: [{ urls: 'stun:b' }] } },
  })
  record('merge: core 与 tracker 字段并存', merged.swarmId === 'swarm-a' && Array.isArray(merged.announceTrackers), merged)
  record('merge: 同名字段 tracker 优先于 core', merged.rtcConfig?.iceServers?.[0]?.urls === 'stun:b', merged.rtcConfig)
}

/** applyRuntimeToggle：运行时开关对 core 同名字段的接管语义 */
function testApplyRuntimeToggle() {
  const userConfig = { swarmId: 'swarm-a', isP2PDisabled: false, isP2PUploadDisabled: false }
  const off = applyRuntimeToggle(userConfig, false, false)
  record('toggle: 关闭态覆盖用户 core 同名字段', off.isP2PDisabled === true && off.isP2PUploadDisabled === true, off)

  const on = applyRuntimeToggle({ swarmId: 'swarm-a' }, true, true)
  record('toggle: 开启态写入显式 false', on.isP2PDisabled === false && on.isP2PUploadDisabled === false, on)

  const mixed = applyRuntimeToggle({}, true, false)
  record('toggle: 仅上传关闭的混合态', mixed.isP2PDisabled === false && mixed.isP2PUploadDisabled === true, mixed)

  record('toggle: 不修改传入的原配置对象', userConfig.isP2PDisabled === false && userConfig.isP2PUploadDisabled === false, userConfig)

  const preserved = applyRuntimeToggle({ swarmId: 'keep' }, true, true)
  record('toggle: 透传字段保留', preserved.swarmId === 'keep', preserved)
}

/** P2PStatsEngine：分类累加 / 非负保护 / 派生指标 / 重置语义 */
function testStatsEngine() {
  const stats = new P2PStatsEngine()
  stats.recordPeerConnect()
  stats.recordPeerConnect()
  stats.recordPeerClose()
  const afterClose = stats.snapshot()
  record('stats: peers 计数与峰值维护', afterClose.peers === 1 && afterClose.peakPeers === 2, {
    peers: afterClose.peers,
    peakPeers: afterClose.peakPeers,
  })

  stats.recordPeerClose()
  stats.recordPeerClose()
  record('stats: 关闭超额时计数钳制为零', stats.snapshot().peers === 0, stats.snapshot().peers)

  stats.recordDownload(600, 'p2p', 1000)
  stats.recordDownload(400, 'http', 1000)
  stats.recordUpload(200, 1000)
  stats.recordDownload(-5, 'p2p', 1000)
  const totals = stats.snapshot()
  record('stats: 分类累加且负值被忽略', totals.p2pDownloadedBytes === 600 && totals.httpDownloadedBytes === 400 && totals.uploadedBytes === 200, totals)
  record('stats: 总量与占比派生正确', totals.totalDownloadedBytes === 1000 && Math.abs(totals.p2pDownloadRatio - 0.6) < 1e-9, {
    total: totals.totalDownloadedBytes,
    ratio: totals.p2pDownloadRatio,
  })

  const speed = stats.snapshot(11_000)
  const expectedDownload = (600 + 400) / (BANDWIDTH_WINDOW_MS / 1000)
  const expectedUpload = 200 / (BANDWIDTH_WINDOW_MS / 1000)
  record('stats: 下行速率 = 两下行通道之和（固定时间源）', Math.abs(speed.downloadSpeed - expectedDownload) < 1e-9, {
    downloadSpeed: speed.downloadSpeed,
    expected: expectedDownload,
  })
  record('stats: p2p 速率分量正确', Math.abs(speed.p2pDownloadSpeed - 600 / (BANDWIDTH_WINDOW_MS / 1000)) < 1e-9, speed.p2pDownloadSpeed)
  record('stats: 上行速率独立统计', Math.abs(speed.uploadSpeed - expectedUpload) < 1e-9, speed.uploadSpeed)

  stats.resetPeers()
  const afterResetPeers = stats.snapshot()
  record('stats: resetPeers 仅清 peer 保留字节', afterResetPeers.peers === 0 && afterResetPeers.p2pDownloadedBytes === 600, afterResetPeers)

  stats.reset()
  const afterReset = stats.snapshot(12_000)
  record('stats: reset 全部清零', afterReset.totalDownloadedBytes === 0 && afterReset.peakPeers === 0 && afterReset.downloadSpeed === 0, afterReset)
}

/** BandwidthCalculator：滑动窗口速率与过期清理 */
function testBandwidthCalculator() {
  const windowMs = 10_000
  const calc = new BandwidthCalculator(windowMs)
  calc.record(1000, 0)
  calc.record(1000, windowMs / 2)
  record('bandwidth: 窗口内速率按整窗折算', Math.abs(calc.getSpeed(windowMs / 2) - 2000 / (windowMs / 1000)) < 1e-9, calc.getSpeed(windowMs / 2))

  // 设计使前两个样本真正过期：cutoff = 5001，t=0 与 t=5000 均在窗外，仅 t=15001 保留
  calc.record(1000, windowMs * 1.5 + 1)
  const expired = calc.getSpeed(windowMs * 1.5 + 1)
  record('bandwidth: 窗口外样本惰性清理', Math.abs(expired - 1000 / (windowMs / 1000)) < 1e-9, expired)

  const empty = new BandwidthCalculator(windowMs)
  empty.record(0, 0)
  empty.record(-1, 0)
  record('bandwidth: 非正值样本被忽略', empty.getSpeed(100) === 0, empty.getSpeed(100))

  const boundary = new BandwidthCalculator(windowMs)
  boundary.record(1000, 0)
  boundary.record(1000, windowMs)
  // 边界语义：age 恰等于窗长的样本（t=0）保留在窗口内，两条样本合计 2000
  record('bandwidth: 边界样本（age 恰等于窗长）保留', Math.abs(boundary.getSpeed(windowMs) - 2000 / (windowMs / 1000)) < 1e-9, boundary.getSpeed(windowMs))
}

/** 事件映射表：键数量与前缀约定 */
function testEventBridgeMap() {
  const keys = Object.keys(P2P_EVENT_BRIDGE_MAP)
  record('events: 覆盖 15 个 Core 事件', keys.length === 15, keys.length)
  record('events: 全部映射为 p2p: 前缀', Object.values(P2P_EVENT_BRIDGE_MAP).every(name => name.startsWith('p2p:')), Object.values(P2P_EVENT_BRIDGE_MAP))
}

const startTime = Date.now()
try {
  testResolveOptions()
  testResolveBadge()
  testMergeCoreConfig()
  testApplyRuntimeToggle()
  testStatsEngine()
  testBandwidthCalculator()
  testEventBridgeMap()
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
  verdict: failed.length === 0 ? 'PASS: pure 层单测通过' : 'FAIL: 存在失败断言',
  assertions,
  elapsedMs: Date.now() - startTime,
}

mkdirSync(OUTPUT_DIR, { recursive: true })
const outputPath = join(OUTPUT_DIR, `test-pure-${Date.now()}.json`)
writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')

console.log(`\n===== pure 层单元测试 =====`)
console.log(`通过 ${report.passed}/${report.total}，耗时 ${report.elapsedMs}ms`)
for (const item of assertions) {
  console.log(`${item.pass ? '✓' : '✗'} ${item.name}`)
}
console.log(`结果已写入: ${outputPath}`)
console.log(`结论: ${report.verdict}`)

// 有界退出：断言失败以非零码结束，便于 CI 与脚本链路感知
process.exit(failed.length === 0 ? 0 : 1)
