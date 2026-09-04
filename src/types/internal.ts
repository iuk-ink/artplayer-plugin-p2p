/**
 * 内部类型契约（不对外发布）
 *
 * 由入口层从公共选项归一化生成，供引擎与编排层直接消费；
 * 变更须先同步全部下游再动手
 *
 * @module types/internal
 */

import type { CoreConfig } from 'p2p-media-loader-core'
import type { HlsConfig } from 'hls.js'
import type { P2POptions, P2PTrackerOptions, P2PSettingItemsOptions } from './options'

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
  /** 右上角数据徽章初始显示开关（uiEnabled 且 statsEnabled 且 badge 选项为 true） */
  badgeEnabled: boolean
  /** 设置开关组挂载开关（uiEnabled 且对象形式 setting !== false） */
  settingEnabled: boolean
  /** 设置开关组单项显示配置（已含默认值） */
  settingItems: P2PSettingItemsOptions
  /** 原始透传的 core / tracker / hls 配置 */
  core?: Partial<CoreConfig>
  tracker?: P2PTrackerOptions
  hls?: Partial<HlsConfig>
}

/** 引擎消费的选项结构化子集（ResolvedOptions 结构化兼容） */
export interface EngineOptions extends Pick<P2POptions, 'core' | 'tracker' | 'hls' | 'fatalRetryMax'> {
  /** 当前 P2P 开关状态（注入 isP2PDisabled） */
  p2pEnabled: boolean
  /** 当前上传开关状态（注入 isP2PUploadDisabled） */
  uploadEnabled: boolean
}
