/**
 * 控制器状态机测试脚本（jsdom-free，纯对象假体）
 *
 * 经构造器注入假实例工厂，验证 P2PController 的编排逻辑：
 * - activate 幂等与 destroyed 终态守卫
 * - fatal 恢复的有界重建与耗尽上报（经 hooks 回调模拟恢复策略决定）
 * - 重建 / 换源 / 重连路径的模式注入（开关状态不丢失）
 * - 销毁清理（实例销毁、art.hls 槽位清空、幂等）
 *
 * 假工厂不触达真实引擎（真实引擎在 Node 下的构造依赖面与
 * 编排逻辑无关），fatal 路径由测试直接调用控制器传入的
 * onUnrecoverable 钩子驱动——控制器契约是「恢复策略决定后
 * 交由编排层」，该契约正是被测对象
 *
 * 前置条件：先执行 npm run build 生成 dist
 * 结果输出到 output/test-controller-<时间戳>.json，进程自动退出
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'

const { P2PController, resolveOptions, P2PStatsEngine } = createRequire(import.meta.url)('../dist/index.js')

const OUTPUT_DIR = 'output'
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
 * 创建播放器假体：记录事件与槽位，供编排断言使用
 *
 * i18n.get 返回带标记键值，证明 fatalNotice 文案经 i18n 路由
 */
function createArtMock() {
  const listeners = new Map()
  const emitted = []
  const noticeShows = []
  const art = {
    option: {},
    hls: undefined,
    notice: {
      get show() {
        return noticeShows[noticeShows.length - 1]
      },
      set show(value) {
        noticeShows.push(value)
      },
    },
    i18n: { get: key => `i18n:${key}` },
    on(name, cb) {
      listeners.set(name, cb)
    },
    off(name) {
      listeners.delete(name)
    },
    emit(name, ...args) {
      emitted.push([name, args])
      const cb = listeners.get(name)
      if (cb) cb(...args)
    },
  }
  return { art, listeners, emitted, noticeShows }
}

/**
 * 创建假实例工厂：每次调用产出一个记录型假实例并登记
 *
 * 创建后立即触发 onEngineCreated（模拟真实引擎构造期事件桥挂载时机）；
 * p2pEngine 提供 addEventListener（事件桥挂载面）与 applyDynamicConfig
 * （运行时开关面），与真实引擎的表面同构
 */
function createFakeFactory() {
  const instances = []
  const factory = (options, hlsCtor, hooks) => {
    const instance = {
      options,
      hooks,
      loadSourceCalls: [],
      attachMediaCalls: [],
      dynamicConfigCalls: [],
      destroyed: false,
      p2pEngine: {
        eventListeners: [],
        addEventListener(name, cb) {
          instance.p2pEngine.eventListeners.push([name, cb])
        },
        applyDynamicConfig(patch) {
          instance.dynamicConfigCalls.push(patch)
        },
      },
      loadSource(url) {
        instance.loadSourceCalls.push(url)
      },
      attachMedia(video) {
        instance.attachMediaCalls.push(video)
      },
      destroy() {
        instance.destroyed = true
      },
    }
    instances.push(instance)
    hooks.onEngineCreated(instance.p2pEngine)
    return instance
  }
  factory.instances = instances
  return factory
}

/** 构造一个挂接假工厂的控制器（返回控制器与全部假体引用） */
function setup(options = {}) {
  const { art, emitted, noticeShows } = createArtMock()
  const factory = createFakeFactory()
  const stats = new P2PStatsEngine()
  const controller = new P2PController(art, resolveOptions(options), stats, factory)
  return { controller, factory, art, emitted, noticeShows, stats }
}

const VIDEO = { src: '' }

function main() {
  // ① activate 幂等语义：重复激活先销毁旧实例再重建，收敛为单活跃实例
  {
    const { controller, factory, art } = setup()
    controller.activate('http://a.m3u8', VIDEO)
    controller.activate('http://a.m3u8', VIDEO)
    record('activate: 重复激活先销毁旧实例', factory.instances.length === 2 && factory.instances[0].destroyed === true, factory.instances.length)
    record('activate: 活跃实例加载最近地址', factory.instances[1].loadSourceCalls.length === 1 && factory.instances[1].loadSourceCalls[0] === 'http://a.m3u8', factory.instances[1].loadSourceCalls)
    record('activate: 事件桥已挂载引擎', factory.instances[1].p2pEngine.eventListeners.length > 0, factory.instances[1].p2pEngine.eventListeners.map(([name]) => name))
    record('activate: art.hls 槽位指向活跃实例', art.hls === factory.instances[1])
    record('activate: 状态为 active', controller.state === 'active')

    // ② destroyed 终态守卫：销毁后激活静默
    controller.destroy()
    controller.activate('http://b.m3u8', VIDEO)
    record('destroyed: 激活被守卫', factory.instances.length === 2 && art.hls === undefined && controller.state === 'destroyed')
  }

  // ③ fatal 有界重建：默认上限 2 次，第 3 次耗尽只上报不再重建
  {
    const { controller, factory, emitted } = setup()
    controller.activate('http://a.m3u8', VIDEO)
    const fireUnrecoverable = retry => factory.instances[factory.instances.length - 1].hooks.onUnrecoverable({ reason: 'x' }, retry)

    fireUnrecoverable(0)
    fireUnrecoverable(1)
    record('fatal: 耗尽前每次重建一个实例', factory.instances.length === 3, factory.instances.length)
    fireUnrecoverable(2)
    record('fatal: 耗尽后不再重建', factory.instances.length === 3, factory.instances.length)

    const fatalEvents = emitted.filter(([name]) => name === 'p2p:fatalError')
    const exhaustion = fatalEvents[fatalEvents.length - 1]
    record(
      'fatal: 耗尽时派发带原因的上报',
      exhaustion !== undefined && exhaustion[1][0]?.reason === 'recreate-limit-exceeded',
      exhaustion,
    )
    record('fatal: 耗尽后实例仍可用', controller.state === 'active' && controller.hls === factory.instances[2])
  }

  // ④ fatalNotice：耗尽时经 notice 提示且文案经 i18n；软恢复期不提示
  {
    const { controller, factory, noticeShows } = setup({ fatalNotice: true })
    controller.activate('http://a.m3u8', VIDEO)
    factory.instances[0].hooks.onUnrecoverable({ reason: 'x' }, 0)
    record('fatalNotice: 软恢复期不提示', noticeShows.length === 0, noticeShows)
    factory.instances[1].hooks.onUnrecoverable({ reason: 'x' }, 1)
    factory.instances[2].hooks.onUnrecoverable({ reason: 'x' }, 2)
    record('fatalNotice: 耗尽时提示一次且经 i18n', noticeShows.length === 1 && noticeShows[0] === 'i18n:P2P 加速恢复失败，已转为直连播放', noticeShows)
  }

  // ⑤ 重建时模式注入：关闭 P2P 后触发重建，实例选项携带当前开关状态
  // （controller 层契约 = engineOptions 的开关与运行时状态一致；
  //   开关写入 core 字段发生在引擎工厂内部，已由 pure 层覆盖）
  {
    const { controller, factory } = setup()
    controller.activate('http://a.m3u8', VIDEO)
    controller.setP2PEnabled(false)
    factory.instances[0].hooks.onUnrecoverable({ reason: 'x' }, 0)
    const rebuilt = factory.instances[1]
    record('rebuild: 重建实例携带关闭态开关', rebuilt.options.p2pEnabled === false && rebuilt.options.uploadEnabled === true, { p2pEnabled: rebuilt.options.p2pEnabled, uploadEnabled: rebuilt.options.uploadEnabled })
    record('rebuild: 重建后实例就位', controller.hls === rebuilt && rebuilt.loadSourceCalls[0] === 'http://a.m3u8')
  }

  // ⑥ 换源与 reload：reload 复用最近地址
  {
    const { controller, factory } = setup()
    controller.activate('http://a.m3u8', VIDEO)
    controller.activate('http://b.m3u8', VIDEO)
    const previous = factory.instances[0]
    record('switch: 换源销毁前实例', previous.destroyed === true)
    controller.reload()
    const reloaded = factory.instances[2]
    record('switch: reload 加载最近地址', controller.hls === reloaded && reloaded.loadSourceCalls[0] === 'http://b.m3u8', reloaded.loadSourceCalls)
  }

  // ⑦ 运行时开关：无损动态配置 + 状态广播
  {
    const { controller, factory, emitted } = setup()
    controller.activate('http://a.m3u8', VIDEO)
    const instance = factory.instances[0]
    controller.setP2PEnabled(false)
    record('toggle: 动态配置下发关闭态', instance.dynamicConfigCalls.length === 1 && instance.dynamicConfigCalls[0]?.core?.isP2PDisabled === true, instance.dynamicConfigCalls)
    record('toggle: stateChange 广播关闭态', emitted.some(([name, args]) => name === 'p2p:stateChange' && args[0]?.p2pEnabled === false))
    controller.setP2PEnabled(false)
    record('toggle: 同值切换不下发', instance.dynamicConfigCalls.length === 1, instance.dynamicConfigCalls)
  }

  // ⑧ 销毁清理：实例销毁、槽位清空、幂等
  {
    const { controller, factory, art } = setup()
    controller.activate('http://a.m3u8', VIDEO)
    const instance = factory.instances[0]
    controller.destroy()
    record('destroy: 实例已销毁', instance.destroyed === true)
    record('destroy: art.hls 槽位清空', art.hls === undefined)
    record('destroy: 状态进入 destroyed', controller.state === 'destroyed')
    controller.destroy()
    controller.deactivate()
    record('destroy: 终态后操作幂等', factory.instances.length === 1 && controller.state === 'destroyed')
  }
}

const startTime = Date.now()
try {
  main()
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
  verdict: failed.length === 0 ? 'PASS: 控制器状态机断言通过' : 'FAIL: 存在失败断言',
  assertions,
  elapsedMs: Date.now() - startTime,
}

mkdirSync(OUTPUT_DIR, { recursive: true })
const outputPath = join(OUTPUT_DIR, `test-controller-${Date.now()}.json`)
writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')

console.log(`\n===== 控制器状态机测试 =====`)
console.log(`通过 ${report.passed}/${report.total}，耗时 ${report.elapsedMs}ms`)
for (const item of assertions) {
  console.log(`${item.pass ? '✓' : '✗'} ${item.name}`)
}
console.log(`结果已写入: ${outputPath}`)
console.log(`结论: ${report.verdict}`)

process.exit(failed.length === 0 ? 0 : 1)
