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
import type { P2PPluginHandle, P2POptions } from './types'
import { P2PStatsEngine } from './stats'
import { P2PController } from './controller'
import { resolveOptions } from './config'
import { mountUI } from './ui'

export type {
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
} from './types'
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
 * ArtPlayer P2P 插件工厂
 *
 * 自动注册 customType 并对首次加载做时序接管（用户零感知）；
 * 返回的句柄挂载在 art.plugins.artplayerPluginP2P
 *
 * @param options - 插件选项
 * @returns ArtPlayer 插件函数
 */
export default function artplayerPluginP2P(options: P2POptions = {}) {
  return (art: Artplayer): P2PPluginHandle => {
    const resolved = resolveOptions(options)
    const stats = new P2PStatsEngine()
    const controller = new P2PController(art, resolved, stats)

    mountUI(art, controller, stats, resolved)

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

    // customType 注册：已占用的格式名不覆盖，仅警告（避免破坏宿主既有集成）
    let registered = false
    const customTypeMap = art.option.customType ?? (art.option.customType = {})
    if (customTypeMap[resolved.typeName]) {
      console.warn(`[artplayer-plugin-p2p] customType "${resolved.typeName}" already exists, skip registering`)
    } else {
      customTypeMap[resolved.typeName] = typeCallback
      registered = true
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
