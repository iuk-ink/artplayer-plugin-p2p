/**
 * 插件句柄与工厂类型契约
 *
 * @module types/handle
 */

import type Artplayer from 'artplayer'
import type { HlsJsP2PEngine } from 'p2p-media-loader-hlsjs'
import type { DynamicCoreConfig } from 'p2p-media-loader-core'
import type Hls from 'hls.js'
import type { P2POptions } from './options'
import type { P2PStats } from './stats'

/** 挂载在 art.plugins.artplayerPluginP2P 上的插件句柄 */
export interface P2PPluginHandle {
  /** 插件名（ArtPlayer 以此作为挂载键） */
  name: 'artplayerPluginP2P'
  /** 当前 P2P 引擎实例（无活跃播放实例时为 undefined） */
  readonly engine?: HlsJsP2PEngine
  /** 当前播放实例（与 art.hls 槽位同步） */
  readonly hls?: Hls
  /** 销毁当前播放实例 */
  destroy(): void
  /** 销毁现有实例后按当前 URL 重建 */
  reload(): void
  /** 获取 P2P 运行时统计快照 */
  getStats(): P2PStats
  /** P2P 运行时开关：经 applyDynamicConfig 无损切换，不销毁实例、不中断播放 */
  setP2PEnabled(enabled: boolean): void
  /** 当前 P2P 是否处于启用状态 */
  isP2PEnabled(): boolean
  /** 上行运行时开关：仅信令广播，完全无缝 */
  setUploadEnabled(enabled: boolean): void
  /** 当前上传是否处于启用状态 */
  isUploadEnabled(): boolean
  /** 程序化设置右上角数据徽章显隐（无 UI 或统计总闸关闭时静默无操作） */
  setBadgeVisible(visible: boolean): void
  /** 右上角数据徽章当前是否显示（无 UI 或统计总闸关闭时恒为 false） */
  isBadgeVisible(): boolean
  /**
   * 订阅统计心跳（1Hz 快照推送，随订阅启停；播放器销毁时全部失效）
   *
   * 订阅即同步送达一次当前快照（无需等待下一个心跳周期完成
   * 首帧渲染）。供宿主外部 UI 消费统计数据（headless 模式），
   * 替代外部自建 setInterval 轮询 getStats()
   *
   * @param callback - 每个心跳周期收到一次统计快照
   * @returns 取消订阅函数
   */
  onStatsTick(callback: (snapshot: P2PStats) => void): () => void
  /** 运行时动态配置透传（DynamicCoreConfig；swarmId 等静态属性由 p2pml 内建防篡改） */
  applyDynamicConfig(patch: DynamicCoreConfig): void
}

// DynamicCoreConfig 随句柄契约一并暴露：
// 宿主构造 applyDynamicConfig 参数时无需翻找依赖包的类型入口
export type { DynamicCoreConfig } from 'p2p-media-loader-core'

/**
 * 插件工厂（default 导出的类型形态）
 *
 * 调用签名之外携带静态成员：DEBUG 调试日志开关（对齐 Artplayer.DEBUG
 * 惯例）与 version 版本号（构建期自 package.json 注入），供宿主在
 * ESM / IIFE 两种接入形态下统一读取
 */
export interface P2PPluginFactory {
  /** 创建插件（option.plugins 注入） */
  (options?: P2POptions): (art: Artplayer) => P2PPluginHandle
  /** 调试日志总开关：置 true 后输出插件装配细节，默认 false（对齐 Artplayer.DEBUG 惯例） */
  DEBUG: boolean
  /** 插件版本号（构建期自 package.json 注入；只读语义，请勿在宿主侧改写） */
  version: string
}
