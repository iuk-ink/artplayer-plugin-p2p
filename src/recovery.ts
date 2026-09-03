/**
 * hls.js fatal 错误分级恢复策略
 *
 * 按 hls.js 官方最佳实践实施三级自愈：
 * 网络级 startLoad() → 媒体级 recoverMediaError()（二次失败自动
 * swapAudioCodec）→ 其他/超限交由上层销毁重建；全部动作有界。
 * 通过回调注入通知上层（不依赖 ArtPlayer），保持模块可移植性
 *
 * @module recovery
 */

import type Hls from 'hls.js'
import type { ErrorData } from 'hls.js'

/** 恢复策略回调集合（由编排层注入并绑定到具体通知渠道） */
export interface FatalRecoveryOptions {
  /** 单实例内软恢复的最大次数上限 */
  retryMax: number
  /** 每次 fatal 发生时通知（含软恢复与放弃两种情形，附当前重试序号） */
  onFatalError: (data: ErrorData, retryCount: number) => void
  /** 遇到不可软恢复的 fatal（其他类型错误），交由上层销毁重建 */
  onUnrecoverable: (data: ErrorData, retryCount: number) => void
}

/**
 * fatal 分级恢复策略
 *
 * 挂载在单个 hls.js 实例的 ERROR 事件上，随实例销毁而失效；
 * 软恢复计数为实例级（重建后的新实例从零计数）
 */
export class FatalRecoveryPolicy {
  #retryCount = 0
  #isMediaRecoveryAttempted = false
  readonly #options: FatalRecoveryOptions

  /**
   * @param hls - 目标 hls.js 实例
   * @param hlsConstructor - hls.js 构造器（Events/ErrorTypes 枚举来源，
   *   避免本模块引入 hls.js 运行时值以保持可移植性）
   * @param options - 回调集合
   */
  constructor(
    hls: Hls,
    hlsConstructor: typeof Hls,
    options: FatalRecoveryOptions,
  ) {
    this.#options = options
    hls.on(hlsConstructor.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      this.#handleFatal(hls, hlsConstructor, data)
    })
  }

  /**
   * fatal 分级处理
   *
   * 网络级：重新拉起加载；媒体级：软恢复（连续失败时切换音频编解码）；
   * 其他：软恢复无效，交由上层重建。超限后停止一切动作，
   * 仅保留通知，由宿主决策后续（如提示用户或换源）
   */
  #handleFatal(
    hls: Hls,
    hlsConstructor: typeof Hls,
    data: ErrorData,
  ): void {
    const { retryMax, onFatalError, onUnrecoverable } = this.#options

    if (this.#retryCount >= retryMax) {
      onFatalError(data, this.#retryCount)
      return
    }
    this.#retryCount += 1
    onFatalError(data, this.#retryCount)

    const { ErrorTypes } = hlsConstructor
    if (data.type === ErrorTypes.NETWORK_ERROR) {
      hls.startLoad()
    } else if (data.type === ErrorTypes.MEDIA_ERROR) {
      if (this.#isMediaRecoveryAttempted) {
        hls.swapAudioCodec()
      }
      hls.recoverMediaError()
      this.#isMediaRecoveryAttempted = true
    } else {
      onUnrecoverable(data, this.#retryCount)
    }
  }
}
