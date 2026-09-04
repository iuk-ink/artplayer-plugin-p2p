/**
 * UI 装配矩阵测试脚本（jsdom）
 *
 * 对 mountUI 的装配分支（ui × stats × badge × setting × 宿主
 * option.setting）做自动化断言：各组件挂载与否、开关组项数与
 * 文案 i18n 路由、徽章初始显隐、onStatsTick 订阅与退订、
 * p2p:statsTick 事件推送、无 UI 时句柄静默
 *
 * 前置条件：先执行 npm run build 生成 dist
 * 结果输出到 output/test-ui-<时间戳>.json，进程自动退出
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')

// 组件运行时依赖的浏览器全局（mountUI 调用时触达，模块加载期不触达）
globalThis.window = dom.window
globalThis.document = dom.window.document

// CJS default 经 require 取得（Node 的 import(CJS) 不解包 __esModule，
// 其 namespace.default 会指向模块导出对象而非工厂函数）
const artplayerPluginP2P = createRequire(import.meta.url)('../dist/index.js').default

const OUTPUT_DIR = 'output'
const assertions = []

function record(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: detail ?? null })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 创建 mock 播放器实例并装配插件
 *
 * mock 仅覆盖装配链触达的最小表面：$player（DOM 挂载）、
 * option（setting 门控）、info（面板互斥）、contextmenu / setting
 * （挂载收集）、on/off/emit（事件）、i18n（文案解析记录，
 * get 返回带标记键值以证明文案经 i18n 路由而非硬编码）
 */
function mount(options, { hostSetting = true } = {}) {
  const $player = document.createElement('div')
  const added = []
  const listeners = new Map()
  const i18nUpdates = []

  const art = {
    option: { customType: {}, setting: hostSetting, url: '' },
    template: {
      $player,
      $video: { getAttribute: () => null, removeAttribute() {}, load() {} },
    },
    on(name, cb) {
      listeners.set(name, cb)
    },
    off() {},
    emit(name, ...args) {
      const cb = listeners.get(name)
      if (cb) cb(...args)
    },
    i18n: {
      update(lang) {
        i18nUpdates.push(lang)
      },
      get: key => `i18n:${key}`,
    },
    notice: {},
    info: { show: false },
    contextmenu: {
      add(item) {
        added.push({ kind: 'contextmenu', ...item })
      },
    },
    setting: {
      add(item) {
        added.push({ kind: 'setting', ...item })
      },
    },
  }

  const pluginFn = artplayerPluginP2P(options)
  const handle = pluginFn(art)
  return { art, $player, added, handle, listeners, i18nUpdates }
}

function settingNames(added) {
  return added.filter(item => item.kind === 'setting').map(item => item.name)
}

function contextmenuNames(added) {
  return added.filter(item => item.kind === 'contextmenu').map(item => item.name)
}

async function main() {
  // ① 默认配置：面板 + 徽章（隐藏）+ 三项开关
  {
    const { $player, added, handle, i18nUpdates } = mount({})
    record('默认: 右键菜单项已挂载', contextmenuNames(added).includes('artp2pStats'), contextmenuNames(added))
    record('默认: 面板 DOM 已挂载', Boolean($player.querySelector('.art-info.artp2p-info')))
    record('默认: 面板标题经 i18n 解析', $player.querySelector('.art-info-title')?.textContent === 'i18n:P2P 状态:', $player.querySelector('.art-info-title')?.textContent)
    record('默认: 右键菜单文案经 i18n 解析', added.find(item => item.kind === 'contextmenu')?.html === 'i18n:P2P 统计', added.find(item => item.kind === 'contextmenu')?.html)
    record('默认: 徽章 DOM 已挂载', Boolean($player.querySelector('.artp2p-badge')))
    record('默认: 徽章初始隐藏', !$player.classList.contains('artp2p-badge-show'))
    const names = settingNames(added)
    record('默认: 三项开关全挂载', names.includes('artp2pSetting') && names.includes('artp2pUploadSetting') && names.includes('artp2pStatsSetting'), names)
    record('默认: isBadgeVisible 为 false', handle.isBadgeVisible() === false)
    const p2pItem = added.find(item => item.kind === 'setting' && item.name === 'artp2pSetting')
    record('默认: 开关文案经 i18n 解析', Boolean(p2pItem) && p2pItem.html === 'i18n:P2P 加速', p2pItem?.html)
    const enPack = i18nUpdates[0]?.en
    record(
      '默认: 英文语言包已注册',
      Boolean(enPack)
        && enPack['P2P 加速'] === 'P2P Acceleration'
        && enPack['P2P 状态'] === 'P2P State'
        && enPack['运行中'] === 'Running'
        && enPack['节点'] === 'peers',
      enPack,
    )
  }

  // ② badge: true 初始显示
  {
    const { $player, handle } = mount({ badge: true })
    record('badge:true: 徽章初始可见', $player.classList.contains('artp2p-badge-show'))
    handle.setBadgeVisible(false)
    record('badge:true: setBadgeVisible(false) 后隐藏', !$player.classList.contains('artp2p-badge-show') && !handle.isBadgeVisible())
  }

  // ③ stats: false：统计 UI 全部跳过，开关组仅剩两项
  {
    const { $player, added, handle } = mount({ stats: false })
    record('stats:false: 无右键菜单项', contextmenuNames(added).length === 0)
    record('stats:false: 无面板 DOM', !Boolean($player.querySelector('.art-info.artp2p-info')))
    record('stats:false: 无徽章 DOM', !Boolean($player.querySelector('.artp2p-badge')))
    const names = settingNames(added)
    record('stats:false: 开关组仅剩两项', names.includes('artp2pSetting') && names.includes('artp2pUploadSetting') && !names.includes('artp2pStatsSetting'), names)
    record('stats:false: onStatsTick 仍可用', typeof handle.onStatsTick(() => {}) === 'function')
  }

  // ④ ui: false：无任何 UI，句柄静默
  {
    const { $player, added, handle } = mount({ ui: false })
    record('ui:false: 无统计面板', !Boolean($player.querySelector('.art-info.artp2p-info')))
    record('ui:false: 无徽章', !Boolean($player.querySelector('.artp2p-badge')))
    record('ui:false: 无开关组', settingNames(added).length === 0)
    handle.setBadgeVisible(true)
    record('ui:false: setBadgeVisible 静默', handle.isBadgeVisible() === false)
  }

  // ⑤ ui.setting: false：开关组整组跳过，面板与徽章正常
  {
    const { $player, added } = mount({ ui: { setting: false } })
    record('setting:false 组: 无开关组', settingNames(added).length === 0)
    record('setting:false 组: 面板与徽章正常', Boolean($player.querySelector('.art-info.artp2p-info')) && Boolean($player.querySelector('.artp2p-badge')))
  }

  // ⑥ ui.setting 单项隐藏
  {
    const { added } = mount({ ui: { setting: { uploadOnly: false } } })
    const names = settingNames(added)
    record('单项隐藏: 仅两项挂载', names.includes('artp2pSetting') && names.includes('artp2pStatsSetting') && !names.includes('artp2pUploadSetting'), names)
  }

  // ⑦ 宿主 option.setting 未开启：开关组跳过，面板与徽章不受影响
  {
    const { $player, added, handle } = mount({ badge: true }, { hostSetting: false })
    record('宿主无 setting: 无开关组', settingNames(added).length === 0)
    record('宿主无 setting: 徽章仍初始可见', $player.classList.contains('artp2p-badge-show') && handle.isBadgeVisible() === true)
  }

  // ⑧ onStatsTick：订阅收到快照、退订后停止
  {
    const { handle } = mount({ badge: true })
    let ticks = 0
    let lastSnapshot = null
    const unsubscribe = handle.onStatsTick((snapshot) => {
      ticks += 1
      lastSnapshot = snapshot
    })

    await sleep(1150)
    record('onStatsTick: 订阅期间收到快照', ticks >= 1, { ticks })
    record('onStatsTick: 快照为全量统计对象', lastSnapshot !== null && typeof lastSnapshot.peers === 'number' && typeof lastSnapshot.downloadSpeed === 'number', lastSnapshot)

    unsubscribe()
    const stable = ticks
    await sleep(1150)
    record('onStatsTick: 退订后不再推送', ticks === stable, { before: stable, after: ticks })

    // destroy 兜底：清空订阅并停表（不抛错即通过）
    handle.destroy()
    record('onStatsTick: destroy 幂等无异常', typeof handle.isBadgeVisible() === 'boolean')
  }

  // ⑨ p2p:statsTick 事件：心跳快照的推送式消费（句柄 onStatsTick 的事件形态；
  // 订阅时的首帧同步派发发生在监听器注册之前，此处计入的是周期性心跳）
  {
    const { art } = mount({ badge: true })
    let events = 0
    let lastPayload = null
    art.on('p2p:statsTick', (snapshot) => {
      events += 1
      lastPayload = snapshot
    })

    await sleep(1150)
    record('p2p:statsTick: 心跳期间收到事件', events >= 1, { events })
    record('p2p:statsTick: 载荷为统计快照', lastPayload !== null && typeof lastPayload.peers === 'number' && typeof lastPayload.downloadSpeed === 'number', lastPayload)
  }

  // ⑩ 徽章点击展开：expanded 与 visible 正交，hide 强制收起；
  // 点击与按键 stopPropagation，不穿透到播放器容器与 hotkey
  {
    const { $player, handle } = mount({ badge: true })
    const root = $player.querySelector('.artp2p-badge')
    record(
      '展开: 详情行 label 经 i18n 解析',
      root?.querySelector('[data-field="detail-ratio-label"]')?.textContent === 'i18n:P2P 占比'
        && root?.querySelector('[data-field="detail-total-label"]')?.textContent === 'i18n:累计流量',
      {
        ratio: root?.querySelector('[data-field="detail-ratio-label"]')?.textContent,
        total: root?.querySelector('[data-field="detail-total-label"]')?.textContent,
      },
    )
    record('展开: 首帧同步填充详情数值', /^\d+ \/ \d+$/.test(root?.querySelector('[data-field="detail-peers"]')?.textContent ?? ''), root?.querySelector('[data-field="detail-peers"]')?.textContent)

    let playerClicked = false
    $player.addEventListener('click', () => {
      playerClicked = true
    })

    root.dispatchEvent(new window.Event('click', { bubbles: true }))
    record('展开: 点击后进入展开态', root.classList.contains('artp2p-badge-expanded') && root.getAttribute('aria-expanded') === 'true')
    record('展开: 点击不穿透到播放器', playerClicked === false)

    root.dispatchEvent(new window.Event('click', { bubbles: true }))
    record('展开: 再次点击收起', !root.classList.contains('artp2p-badge-expanded') && root.getAttribute('aria-expanded') === 'false')

    root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    record('展开: Enter 键切换展开', root.classList.contains('artp2p-badge-expanded'))
    root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    record('展开: 其他按键不触发切换', root.classList.contains('artp2p-badge-expanded'))

    handle.setBadgeVisible(false)
    record('展开: 隐藏徽章强制收起', !root.classList.contains('artp2p-badge-expanded') && root.getAttribute('aria-expanded') === 'false')
  }
}

const startTime = Date.now()
try {
  await main()
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
  verdict: failed.length === 0 ? 'PASS: UI 装配矩阵断言通过' : 'FAIL: 存在失败断言',
  assertions,
  elapsedMs: Date.now() - startTime,
}

mkdirSync(OUTPUT_DIR, { recursive: true })
const outputPath = join(OUTPUT_DIR, `test-ui-${Date.now()}.json`)
writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')

console.log(`\n===== UI 装配矩阵测试（jsdom） =====`)
console.log(`通过 ${report.passed}/${report.total}，耗时 ${report.elapsedMs}ms`)
for (const item of assertions) {
  console.log(`${item.pass ? '✓' : '✗'} ${item.name}`)
}
console.log(`结果已写入: ${outputPath}`)
console.log(`结论: ${report.verdict}`)

process.exit(failed.length === 0 ? 0 : 1)
