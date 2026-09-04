/**
 * 插件选项类型契约
 *
 * @module types/options
 */

import type { CoreConfig } from 'p2p-media-loader-core'
import type { HlsConfig } from 'hls.js'

/** 场景预设名：直播（live）与点播（vod）各有一组推荐 core 参数 */
export type ScenePresetName = 'live' | 'vod'

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
  /** 是否显示「P2P 统计」开关（控制右上角 P2P 数据徽章的显示；stats 关闭时无徽章可开，此项不生效） */
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
  /** 场景预设：展开为一组推荐 core 参数（默认 → 预设 → 用户 core 依次覆盖），与 core 逐字段浅合并 */
  preset?: ScenePresetName
  /** 信令服务器配置组，与 core 配置浅合并（本组优先） */
  tracker?: P2PTrackerOptions
  /** 完整 core 配置透传（Partial<CoreConfig>）；其中 isP2PDisabled / isP2PUploadDisabled 由插件开关状态接管 */
  core?: Partial<CoreConfig>
  /** 透传给 hls.js 的配置 */
  hls?: Partial<HlsConfig>
  /** fatal 错误销毁重建的最大次数，默认 2 */
  fatalRetryMax?: number
  /** fatal 恢复耗尽时经播放器 notice 提示用户，默认 false；仅耗尽终态提示一次，编程消费仍以 p2p:fatalError 事件为准 */
  fatalNotice?: boolean
  /** 初始 P2P 开关，默认 true；运行时可经句柄 setP2PEnabled 无损切换 */
  enabled?: boolean
  /** 初始上传开关，默认 true；运行时可经句柄 setUploadEnabled 无缝切换 */
  uploadEnabled?: boolean
  /** 统计展示总开关，默认 true；false 时不挂「P2P 统计」菜单项、面板与右上角徽章，宿主仅能经 getStats() 编程读取 */
  stats?: boolean
  /** 右上角 P2P 数据徽章初始显示状态，默认 false；受 ui / stats 总闸约束 */
  badge?: boolean
  /** UI 总闸：false 时完全无 UI（不挂菜单项 / 面板 / 设置开关组）；对象形式可单独控制设置开关组 */
  ui?: boolean | P2PUIOptions
}
