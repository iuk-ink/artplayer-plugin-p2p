/**
 * ArtPlayer P2P 插件入口
 *
 * 将 p2p-media-loader（hls.js 引擎）封装为 ArtPlayer 插件：
 * 通过 option.plugins 注入即可为 m3u8 播放启用 P2P 分发，
 * 支持自建 tracker 信令服务器配置、运行时开关与统计
 *
 * 组装流程依赖 ArtPlayer 的两个时序事实：
 * 1. 插件工厂在 Player.optionInit 之后执行，首次 URL 加载已经发生，
 *    因此 customType 注册完成后需要对匹配类型的源做二次赋值补救
 * 2. video:error 重连经 art.url 重赋值会重新进入 customType 回调，
 *    回调内控制器的 activate 幂等（先销毁再重建），重入安全
 *
 * 用法：
 *   new Artplayer({
 *     url: 'https://example.com/stream.m3u8',
 *     type: 'm3u8',
 *     plugins: [artplayerPluginP2P({ tracker: { announceTrackers: ['wss://tracker.example.com'] } })],
 *   })
 *
 * @module index
 */

import Hls from 'hls.js'
import type Artplayer from 'artplayer'
import type { P2PPluginFactory, P2PPluginHandle } from './types/handle'
import type { P2POptions } from './types/options'
import type { P2PStats } from './types/stats'
import { P2PStatsEngine } from './stats'
import { StatsTicker } from './stats-tick'
import { P2PController } from './controller'
import { resolveOptions } from './config'
import { isDebugEnabled, log, setDebugEnabled } from './debug'
import { mountUI } from './ui'
import { I18N_MESSAGES, STATS_POLLING_MS } from './constants'

export type {
  P2PPluginFactory,
  P2POptions,
  P2PTrackerOptions,
  P2PUIOptions,
  P2PSettingItemsOptions,
  P2PPluginHandle,
  P2PStats,
  DownloadChannel,
  StateChangeDetails,
  CoreConfig,
  DynamicCoreConfig,
} from './types/index'
export {
  P2P_EVENT_BRIDGE_MAP,
  DEFAULT_TYPE,
  DEFAULT_FATAL_RETRY_MAX,
  BANDWIDTH_WINDOW_MS,
  STATS_POLLING_MS,
} from './constants'
export { resolveOptions, mergeCoreConfig, applyRuntimeToggle } from './config'
export { FatalRecoveryPolicy } from './recovery'
export { createHlsWithP2P } from './engine'
export type { EngineHooks, EngineOptions } from './engine'
export { P2PController } from './controller'
export type { ControllerState } from './controller'
export { P2PStatsEngine } from './stats'
export { StatsTicker, type StatsTickCallback } from './stats-tick'

/**
 * 从 URL 提取小写扩展名（不含点）
 *
 * 依次剥离 hash 与 query 后取最后一个点之后的部分，整体小写化。
 * 与 ArtPlayer 内部 getExt 的差异仅在"无扩展名"场景：官方会返回
 * 去协议后的整条路径，本实现返回空串——两种结果均不会命中
 * customType（宿主该场景必须显式传 option.type），判定殊途同归
 *
 * @param url - 原始 URL
 * @returns 扩展名，无扩展名时返回空字符串
 */
function getUrlExtension(url: string): string {
  const withoutHash = url.split('#')[0]
  const withoutQuery = withoutHash.split('?')[0]
  const lastDotIndex = withoutQuery.lastIndexOf('.')
  if (lastDotIndex === -1) return ''
  return withoutQuery.slice(lastDotIndex + 1).toLowerCase()
}

/**
 * 插件工厂实现：组装 customType 注册、首载时序补救与句柄
 * （DEBUG / version 静态成员经 P2PPluginFactory 类型断言挂载，
 * 见模块尾部的赋值与代理逻辑）
 *
 * @param options - 插件选项
 * @returns ArtPlayer 插件函数
 */
function artplayerPluginP2PImpl(options: P2POptions = {}): (art: Artplayer) => P2PPluginHandle {
  return (art: Artplayer): P2PPluginHandle => {
    const resolved = resolveOptions(options)
    const stats = new P2PStatsEngine()
    const controller = new P2PController(art, resolved, stats)

    // 统计心跳：单一 1Hz 定时器，装配层（面板 / 徽章）与句柄
    // onStatsTick 共享同一数据源与启停状态
    const ticker = new StatsTicker(stats, STATS_POLLING_MS)

    // 语言包注册：键为中文原文（i18n.get 未命中回退键本身，中文站点
    // 零配置），宿主 option.lang 匹配注册语言时自动显示译文；
    // 宿主可在创建后再次 update 覆写插件文案（后注册生效）。
    // 官方 update 类型仅枚举内置 UI 键，而运行时对任意键生效
    // （自定义键正是官方 d.ts 中 @ts-expect-error 的场景），
    // 故此处断言越过键枚举限制
    art.i18n.update(I18N_MESSAGES as Parameters<Artplayer['i18n']['update']>[0])
    log('i18n messages registered')

    const badge = mountUI(art, controller, ticker, resolved)

    // p2p:statsTick 事件：心跳快照的推送式消费约定（与句柄
    // onStatsTick 同源同拍）；以装配层订阅接入而非 ticker 内部
    // 派发，保持统计心跳的纯逻辑层不依赖 art 实例
    const unsubscribeStatsTickEvent = ticker.subscribe((snapshot) => {
      art.emit('p2p:statsTick', snapshot)
    })

    // 播放器销毁时终止事件派发与心跳（组件订阅已随各自 destroy 退订，此处兜底清空）
    art.on('destroy', () => {
      unsubscribeStatsTickEvent()
      ticker.destroy()
    })

    /**
     * customType 回调：URL 设置时由 ArtPlayer 调用
     *
     * 覆盖首次加载、换源与重连全部场景（均收敛为
     * controller.activate，模式取控制器运行时状态）；
     * MSE 不可用时降级为原生 HLS 或 notice 提示
     */
    function typeCallback(video: HTMLVideoElement, url: string): void {
      if (!Hls.isSupported()) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url
        } else {
          art.notice.show = `Unsupported playback format: ${resolved.typeName}`
        }
        return
      }
      controller.activate(url, video)
    }

    // customType 注册：已占用的格式名不覆盖，仅警告（避免破坏宿主既有集成）。
    // 冲突意味着该类型不会被 P2P 接管，属错误级诊断，无条件输出并附行动指引
    let registered = false
    const customTypeMap = art.option.customType ?? (art.option.customType = {})
    if (customTypeMap[resolved.typeName]) {
      console.warn(
        `[artplayer-plugin-p2p] customType "${resolved.typeName}" already exists, P2P takeover skipped; pass a different "type" or remove the existing registration`,
      )
    } else {
      customTypeMap[resolved.typeName] = typeCallback
      registered = true
      log(`customType "${resolved.typeName}" registered`)
    }

    // 首载时序补救：插件工厂晚于首次 URL 加载执行，首次加载已走原生分支
    // （$video.src 指向流地址）。不支持原生 HLS 的浏览器会触发 video:error
    // 进入 ArtPlayer 重连循环，因此需先中止原生加载，
    // 再二次赋值 art.url 命中已注册的 customType 接管为 P2P 播放
    if (registered) {
      const optionUrl = art.option.url
      if (optionUrl) {
        const currentType = art.option.type || getUrlExtension(optionUrl)
        if (currentType === resolved.typeName) {
          const { $video } = art.template
          const rawSrc = $video.getAttribute('src')
          if (rawSrc && !rawSrc.startsWith('blob:')) {
            $video.removeAttribute('src')
            $video.load()
          }
          art.url = optionUrl
          log('first-load remedy applied: reassigned art.url to trigger P2P takeover')
        }
      }
    }

    return {
      name: 'artplayerPluginP2P',
      get engine() {
        return controller.hls?.p2pEngine
      },
      get hls() {
        return controller.hls
      },
      destroy() {
        controller.destroy()
      },
      reload() {
        controller.reload()
      },
      getStats() {
        return stats.snapshot()
      },
      setP2PEnabled(enabled) {
        controller.setP2PEnabled(enabled)
      },
      isP2PEnabled() {
        return controller.p2pEnabled
      },
      setUploadEnabled(enabled) {
        controller.setUploadEnabled(enabled)
      },
      isUploadEnabled() {
        return controller.uploadEnabled
      },
      setBadgeVisible(visible) {
        if (visible) {
          badge?.show()
        } else {
          badge?.hide()
        }
      },
      isBadgeVisible() {
        return badge?.isVisible() ?? false
      },
      onStatsTick(callback: (snapshot: P2PStats) => void): () => void {
        return ticker.subscribe(callback)
      },
      /**
       * 运行时动态配置透传：转发到当前引擎的 Core.applyDynamicConfig；
       * 无活跃实例时不生效（即时调参语义，不做延迟补发）
       */
      applyDynamicConfig(patch) {
        controller.hls?.p2pEngine.applyDynamicConfig({ core: patch })
      },
    }
  }
}

/**
 * 插件工厂（default 导出）：携带 DEBUG / version 静态成员
 */
const artplayerPluginP2P = artplayerPluginP2PImpl as P2PPluginFactory

export default artplayerPluginP2P

// version 为构建期 define 注入的字面量（单一来源 package.json，只读语义）；
// DEBUG 经 getter/setter 代理至调试日志模块：宿主运行时读写立即生效，
// 且入口与 UI 层共享同一状态（独立 debug 模块避免循环依赖）
artplayerPluginP2P.version = __ARTP2P_VERSION__
Object.defineProperty(artplayerPluginP2P, 'DEBUG', {
  enumerable: true,
  get: () => isDebugEnabled(),
  set: (value: boolean) => setDebugEnabled(Boolean(value)),
})
