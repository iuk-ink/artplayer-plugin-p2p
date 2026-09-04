/**
 * P2P 实例生命周期控制器
 *
 * 唯一持有播放实例与跨实例状态（最近 URL / 视频 / 重建计数 /
 * P2P 与上传开关）的状态机；换源、fatal 重建、开关切换、销毁
 * 全部收敛为显式方法。art.hls 槽位的写入与清空只发生在本模块内
 *
 * 开关语义：
 * - P2P / 上传开关经 engine.applyDynamicConfig 无损切换，
 *   不销毁实例、不中断播放
 * - 实例创建（首装 / fatal 重建 / 换源 / 重连）时按当前开关状态
 *   注入初始配置，保证重建后模式不丢失
 * - activate 不接受模式参数：模式一律取控制器运行时状态，
 *   避免 customType 重入路径（video:error 重连）重置用户的开关选择
 *
 * @module controller
 */

import Hls from 'hls.js'
import type Artplayer from 'artplayer'
import type { HlsWithP2PInstance } from 'p2p-media-loader-hlsjs'
import { attachEventBridge } from './bridge'
import { createHlsWithP2P, type EngineHooks } from './engine'
import { I18N_KEY_FATAL_NOTICE } from './constants'
import type { P2PStatsEngine } from './stats'
import type { ResolvedOptions } from './types/internal'
import type { StateChangeDetails } from './types/events'

/** 控制器状态：idle 未创建 / active 播放中 / destroyed 播放器已销毁 */
export type ControllerState = 'idle' | 'active' | 'destroyed'

/** 实例创建函数类型（默认为真实引擎工厂，测试可注入假体） */
type CreateInstance = typeof createHlsWithP2P

/** P2P 实例生命周期控制器 */
export class P2PController {
  readonly #art: Artplayer
  readonly #options: ResolvedOptions
  readonly #stats: P2PStatsEngine
  readonly #createInstance: CreateInstance

  #state: ControllerState = 'idle'
  #p2pEnabled: boolean
  #uploadEnabled: boolean
  /** 跨实例的 fatal 重建计数（外部显式激活时归零，防止无限重建循环） */
  #recreateCount = 0
  #currentUrl?: string
  #currentVideo?: HTMLVideoElement
  #instance?: HlsWithP2PInstance<Hls>
  /** 当前实例在 art 上的 destroy 监听（实例切换时注销，避免累积监听） */
  #destroyHandler?: () => void

  /**
   * @param art - ArtPlayer 实例
   * @param options - 解析后的插件选项（p2pEnabled / uploadEnabled 为初始开关状态）
   * @param stats - 统计引擎实例（由入口层创建并共享给句柄）
   * @param createInstance - 实例创建工厂（默认真实引擎；测试注入假体
   *   以验证状态机编排，真实引擎在 Node 下的构造依赖面与此目标无关）
   */
  constructor(
    art: Artplayer,
    options: ResolvedOptions,
    stats: P2PStatsEngine,
    createInstance: CreateInstance = createHlsWithP2P,
  ) {
    this.#art = art
    this.#options = options
    this.#stats = stats
    this.#p2pEnabled = options.p2pEnabled
    this.#uploadEnabled = options.uploadEnabled
    this.#createInstance = createInstance
  }

  /** 当前控制器状态 */
  get state(): ControllerState {
    return this.#state
  }

  /** 当前 P2P 开关状态 */
  get p2pEnabled(): boolean {
    return this.#p2pEnabled
  }

  /** 当前上传开关状态 */
  get uploadEnabled(): boolean {
    return this.#uploadEnabled
  }

  /** 当前播放实例（与 art.hls 槽位同步） */
  get hls(): HlsWithP2PInstance<Hls> | undefined {
    return this.#instance
  }

  /**
   * 外部显式激活（customType 回调：首次加载 / 换源 / 重连共用）
   *
   * 视为新的播放意图：统计与重建计数全部归零，
   * 以控制器当前开关状态创建实例（不接受模式参数）
   *
   * @param url - 播放地址
   * @param video - 视频元素
   */
  activate(url: string, video: HTMLVideoElement): void {
    if (this.#state === 'destroyed') return
    this.#stop()
    this.#stats.reset()
    this.#recreateCount = 0
    this.#start(url, video)
  }

  /** 销毁当前播放实例（注销监听、清空 art.hls 槽位） */
  deactivate(): void {
    if (this.#state === 'destroyed') return
    this.#stop()
  }

  /** 销毁现有实例后按最近地址与当前开关模式重建 */
  reload(): void {
    if (this.#state === 'destroyed' || this.#currentUrl === undefined) return
    this.activate(this.#currentUrl, this.#currentVideo!)
  }

  /**
   * P2P 运行时开关：经 applyDynamicConfig 无损切换
   *
   * 不销毁实例、不中断播放；关闭时 HybridLoader 被引擎销毁、
   * peer 连接全断，主动清零 peer 计数防止残留（迟到关闭事件
   * 由统计引擎的非负保护兜底）；字节统计冻结保留供模式对照
   *
   * @param enabled - 目标 P2P 状态
   */
  setP2PEnabled(enabled: boolean): void {
    if (this.#state === 'destroyed' || enabled === this.#p2pEnabled) return
    this.#p2pEnabled = enabled
    const engine = this.#instance?.p2pEngine
    if (engine) {
      engine.applyDynamicConfig({ core: { isP2PDisabled: !enabled } })
      if (!enabled) {
        this.#stats.resetPeers()
      }
    }
    this.#emitStateChange()
  }

  /**
   * 上行运行时开关：仅信令广播（引擎内部处理），完全无缝
   *
   * @param enabled - 目标上传状态
   */
  setUploadEnabled(enabled: boolean): void {
    if (this.#state === 'destroyed' || enabled === this.#uploadEnabled) return
    this.#uploadEnabled = enabled
    this.#instance?.p2pEngine.applyDynamicConfig({ core: { isP2PUploadDisabled: !enabled } })
    this.#emitStateChange()
  }

  /** 播放器销毁：终止一切并进入 destroyed（幂等） */
  destroy(): void {
    if (this.#state === 'destroyed') return
    this.#stop()
    this.#state = 'destroyed'
  }

  /**
   * 创建并绑定播放实例（内部路径，不重置任何状态）
   *
   * 构造 EngineOptions 时以控制器当前开关状态覆盖选项初始值：
   * fatal 重建 / 换源 / 重连的实例重建均经此路径，
   * 保证重建后 P2P 与上传模式与用户当前选择一致
   *
   * @param url - 播放地址
   * @param video - 视频元素
   */
  #start(url: string, video: HTMLVideoElement): void {
    const engineOptions = {
      core: this.#options.core,
      tracker: this.#options.tracker,
      hls: this.#options.hls,
      fatalRetryMax: this.#options.fatalRetryMax,
      p2pEnabled: this.#p2pEnabled,
      uploadEnabled: this.#uploadEnabled,
    }

    const hooks: EngineHooks = {
      onEngineCreated: (engine) => {
        attachEventBridge(this.#art, engine, this.#stats)
      },
      onFatalError: (data, retryCount) => {
        this.#art.emit('p2p:fatalError', data, retryCount)
      },
      onUnrecoverable: (data, retryCount) => {
        this.#handleUnrecoverable(data, retryCount)
      },
    }

    const instance = this.#createInstance(engineOptions, Hls, hooks)

    instance.loadSource(url)
    instance.attachMedia(video)

    this.#art.hls = instance
    this.#instance = instance
    this.#currentUrl = url
    this.#currentVideo = video
    this.#state = 'active'

    this.#destroyHandler = () => {
      this.#instance = undefined
      this.#currentVideo = undefined
      this.#state = 'destroyed'
      instance.destroy()
    }
    this.#art.on('destroy', this.#destroyHandler)
  }

  /** 销毁当前实例并回到 idle（不改变开关模式与重建计数） */
  #stop(): void {
    if (this.#destroyHandler) {
      this.#art.off('destroy', this.#destroyHandler)
      this.#destroyHandler = undefined
    }
    const instance = this.#instance
    this.#instance = undefined
    this.#art.hls = undefined
    this.#state = 'idle'
    this.#stats.resetPeers()
    if (instance) {
      instance.destroy()
    }
  }

  /** 开关状态变化后派发 p2p:stateChange，供宿主同步自定义 UI */
  #emitStateChange(): void {
    const details: StateChangeDetails = {
      p2pEnabled: this.#p2pEnabled,
      uploadEnabled: this.#uploadEnabled,
    }
    this.#art.emit('p2p:stateChange', details)
  }

  /**
   * 不可恢复 fatal 的有界重建
   *
   * 重建计数超限后停止动作，发出带原因的 fatalError
   * 事件交由宿主决策（提示用户 / 换源）；fatalNotice 开启时
   * 另经 notice 提示终端用户（文案经 i18n，仅此终态一次）
   */
  #handleUnrecoverable(_data: unknown, _retryCount: number): void {
    if (this.#recreateCount >= this.#options.fatalRetryMax) {
      this.#art.emit('p2p:fatalError', { reason: 'recreate-limit-exceeded', recreateCount: this.#recreateCount }, this.#recreateCount)
      // opt-in 的终端提示：软恢复期不输出；事件照发，编程消费不受影响
      if (this.#options.fatalNotice) {
        this.#art.notice.show = this.#art.i18n.get(I18N_KEY_FATAL_NOTICE)
      }
      return
    }
    this.#recreateCount += 1
    const url = this.#currentUrl
    const video = this.#currentVideo
    if (url === undefined || video === undefined) return
    this.#stop()
    this.#stats.reset()
    this.#start(url, video)
  }
}
