/**
 * 插件公共类型契约
 *
 * 本文件是全项目的类型契约源头：下游模块（引擎 / 编排 / UI）
 * 的签名均以此处定义为准，变更须先同步全部下游再动手
 *
 * @module types
 */

import type { CoreConfig, DownloadSource, DynamicCoreConfig } from 'p2p-media-loader-core'
import type { HlsJsP2PEngine } from 'p2p-media-loader-hlsjs'
import type { HlsConfig } from 'hls.js'
import type Hls from 'hls.js'

// 透传配置所需的 p2pml 类型随公共 API 一并导出：
// 宿主构造 core 选项与 applyDynamicConfig 参数时无需翻找依赖包的类型入口
export type { CoreConfig, DynamicCoreConfig } from 'p2p-media-loader-core'

/**
 * 信令服务器（Tracker）配置组
 *
 * 用于将 P2P 信令从公共 tracker 切换到自建 wt-tracker 等私有部署，
 * 字段名与 p2p-media-loader 的 CoreConfig 完全一致，浅合并进 core
 */
export interface P2PTrackerOptions {
  /** WebTorrent tracker 地址列表；不配置时沿用 p2p-media-loader 官方默认公共 tracker */
  announceTrackers?: string[]
  /** WebRTC STUN/TURN 配置；自建 ICE 服务时覆盖默认的公共 STUN */
  rtcConfig?: RTCConfiguration
}

/**
 * 设置开关组单项显示配置（未指定的项默认显示）
 */
export interface P2PSettingItemsOptions {
  /** 是否显示「P2P 加速」开关 */
  p2pEnabled?: boolean
  /** 是否显示「仅上传模式」开关 */
  uploadOnly?: boolean
  /** 是否显示「P2P 统计」开关（stats 关闭时无面板可开，此项不生效） */
  stats?: boolean
}

export interface P2PUIOptions {
  /**
   * 设置开关组显示配置：
   * - true / 省略：三项全显
   * - false：整组不挂载
   * - 对象：按项选择性显示
   */
  setting?: boolean | P2PSettingItemsOptions
}

/** 插件选项 */
export interface P2POptions {
  /** customType 注册的格式名，默认 'm3u8' */
  type?: string
  /** 信令服务器配置组，与 core 配置浅合并（本组优先） */
  tracker?: P2PTrackerOptions
  /** 完整 core 配置透传（Partial<CoreConfig>）；其中 isP2PDisabled / isP2PUploadDisabled 由插件开关状态接管 */
  core?: Partial<CoreConfig>
  /** 透传给 hls.js 的配置 */
  hls?: Partial<HlsConfig>
  /** fatal 错误销毁重建的最大次数，默认 2 */
  fatalRetryMax?: number
  /** 初始 P2P 开关，默认 true；运行时可经句柄 setP2PEnabled 无损切换 */
  enabled?: boolean
  /** 初始上传开关，默认 true；运行时可经句柄 setUploadEnabled 无缝切换 */
  uploadEnabled?: boolean
  /** 统计展示总开关，默认 true；false 时不挂「P2P 统计」菜单项与面板，宿主仅能经 getStats() 编程读取 */
  stats?: boolean
  /** UI 总闸：false 时完全无 UI（不挂菜单项 / 面板 / 设置开关组）；对象形式可单独控制设置开关组 */
  ui?: boolean | P2PUIOptions
}

/** P2P 运行时统计快照（一次性读取全部累计量与派生指标） */
export interface P2PStats {
  /** 当前已连接的 peer 数量 */
  peers: number
  /** 会话内出现过的峰值 peer 数量 */
  peakPeers: number
  /** 累计 P2P 通道下行字节数 */
  p2pDownloadedBytes: number
  /** 累计 HTTP 通道下行字节数 */
  httpDownloadedBytes: number
  /** 累计 P2P 上行字节数 */
  uploadedBytes: number
  /** 累计总下行字节数（P2P + HTTP） */
  totalDownloadedBytes: number
  /** P2P 下行占总下行比例 0..1（总下行为 0 时为 0） */
  p2pDownloadRatio: number
  /** 总下行速率 B/s（滑动时间窗） */
  downloadSpeed: number
  /** P2P 通道下行速率 B/s（滑动时间窗） */
  p2pDownloadSpeed: number
  /** P2P 上行速率 B/s（滑动时间窗） */
  uploadSpeed: number
}

/** `p2p:stateChange` 事件负载：开关切换后派发，供宿主同步自定义 UI */
export interface StateChangeDetails {
  /** 当前 P2P 开关状态 */
  p2pEnabled: boolean
  /** 当前上传开关状态 */
  uploadEnabled: boolean
}

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
  /** 运行时动态配置透传（DynamicCoreConfig；swarmId 等静态属性由 p2pml 内建防篡改） */
  applyDynamicConfig(patch: DynamicCoreConfig): void
}

/** 下载通道类型（别名自 p2p-media-loader 的 DownloadSource，随上游保持同步） */
export type DownloadChannel = DownloadSource

/**
 * 内部使用：解析默认值后的插件选项
 *
 * 由入口层从 P2POptions 归一化生成，供引擎与编排层直接消费；
 * 不对外发布，避免将内部归一化形态固化为公共 API
 */
export interface ResolvedOptions {
  /** customType 注册的格式名（已含默认值） */
  typeName: string
  /** fatal 销毁重建的最大次数（已含默认值） */
  fatalRetryMax: number
  /** 初始 P2P 开关（已含默认值） */
  p2pEnabled: boolean
  /** 初始上传开关（已含默认值） */
  uploadEnabled: boolean
  /** UI 总闸（ui !== false） */
  uiEnabled: boolean
  /** 统计展示开关（uiEnabled 且 stats !== false） */
  statsEnabled: boolean
  /** 设置开关组挂载开关（uiEnabled 且对象形式 setting !== false） */
  settingEnabled: boolean
  /** 设置开关组单项显示配置（已含默认值） */
  settingItems: P2PSettingItemsOptions
  /** 原始透传的 core / tracker / hls 配置 */
  core?: Partial<CoreConfig>
  tracker?: P2PTrackerOptions
  hls?: Partial<HlsConfig>
}
