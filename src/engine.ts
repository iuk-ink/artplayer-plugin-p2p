/**
 * P2P 播放引擎工厂
 *
 * 职责：
 * - 合并 tracker 快捷配置与 core 全量配置，并注入插件运行时开关状态
 * - 缓存 injectMixin 生成的 HlsWithP2P 构造器（每个 hls.js 构造器仅生成一次）
 * - 创建携带 P2P 能力的 hls.js 实例，并挂载 fatal 分级恢复策略
 *
 * P2P / 上传开关统一经运行时动态配置实现（见 controller），
 * 实例创建时的初始注入保证重建后模式不丢失
 *
 * @module engine
 */

import type Hls from 'hls.js'
import type { ErrorData } from 'hls.js'
import { HlsJsP2PEngine } from 'p2p-media-loader-hlsjs'
import type { HlsWithP2PConfig, HlsWithP2PInstance } from 'p2p-media-loader-hlsjs'
import { applyRuntimeToggle, mergeCoreConfig } from './config'
import { FatalRecoveryPolicy } from './recovery'
import { DEFAULT_FATAL_RETRY_MAX } from './constants'
import type { EngineOptions } from './types/internal'

// EngineOptions 随引擎钩子一并对外导出（契约定义在 types/internal）
export type { EngineOptions }

/** hls.js 构造器类型 */
type HlsConstructor = typeof Hls

/** 注入 P2P 能力后的 hls.js 构造器类型 */
type HlsWithP2PConstructor = ReturnType<typeof HlsJsP2PEngine.injectMixin>

/**
 * 引擎工厂钩子集合（由编排层注入）
 *
 * onEngineCreated 在引擎就绪时触发，供事件桥挂载；
 * 其余两个钩子用于 fatal 通知与不可恢复错误上报
 */
export interface EngineHooks {
  /** P2P 引擎就绪（onHlsJsCreated 时机），供事件桥挂载 */
  onEngineCreated: (engine: HlsJsP2PEngine) => void
  /** fatal 发生通知（含软恢复与放弃两种情形） */
  onFatalError: (data: ErrorData, retryCount: number) => void
  /** 遇到不可软恢复的 fatal，由编排层决定销毁重建 */
  onUnrecoverable: (data: ErrorData, retryCount: number) => void
}

/**
 * injectMixin 结果缓存
 *
 * injectMixin 每次调用都会生成新的子类，重复调用既浪费内存
 * 又会破坏 instanceof 判断的一致性，因此按构造器缓存
 */
const hlsWithP2PCache = new WeakMap<HlsConstructor, HlsWithP2PConstructor>()

/**
 * 获取（或创建并缓存）注入 P2P 能力后的 hls.js 构造器
 *
 * @param hlsConstructor - 宿主提供的 hls.js 构造器
 * @returns HlsWithP2P 构造器
 */
function getHlsWithP2PClass(hlsConstructor: HlsConstructor): HlsWithP2PConstructor {
  let cached = hlsWithP2PCache.get(hlsConstructor)
  if (!cached) {
    cached = HlsJsP2PEngine.injectMixin(hlsConstructor)
    hlsWithP2PCache.set(hlsConstructor, cached)
  }
  return cached
}

/**
 * 创建携带 P2P 能力的 hls.js 播放实例
 *
 * core 配置经 applyRuntimeToggle 注入当前开关状态；
 * 仅完成实例构造与 fatal 恢复挂载，loadSource / attachMedia
 * 的调用时机由调用方决定
 *
 * @param options - 引擎选项（含透传配置与运行时开关状态）
 * @param hlsConstructor - 宿主提供的 hls.js 构造器（peerDependency 实例）
 * @param hooks - 引擎钩子集合
 * @returns HlsWithP2P 播放实例
 */
export function createHlsWithP2P(
  options: EngineOptions,
  hlsConstructor: HlsConstructor,
  hooks: EngineHooks,
): HlsWithP2PInstance<Hls> {
  const HlsWithP2PClass = getHlsWithP2PClass(hlsConstructor)

  const hls = new HlsWithP2PClass({
    ...options.hls,
    p2p: {
      core: applyRuntimeToggle(mergeCoreConfig(options), options.p2pEnabled, options.uploadEnabled),
      onHlsJsCreated(instance) {
        hooks.onEngineCreated(instance.p2pEngine)
      },
    },
  } as HlsWithP2PConfig<typeof Hls>)

  new FatalRecoveryPolicy(hls, hlsConstructor, {
    retryMax: options.fatalRetryMax ?? DEFAULT_FATAL_RETRY_MAX,
    onFatalError: hooks.onFatalError,
    onUnrecoverable: hooks.onUnrecoverable,
  })

  return hls
}
