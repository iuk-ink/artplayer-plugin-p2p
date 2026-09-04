/**
 * 插件常量定义
 *
 * @module constants
 */

import type { CoreConfig, CoreEventMap } from 'p2p-media-loader-core'
import type { ScenePresetName } from './types/options'

/** customType 注册的默认格式名 */
export const DEFAULT_TYPE = 'm3u8'

/** fatal 错误销毁重建的默认最大次数 */
export const DEFAULT_FATAL_RETRY_MAX = 2

/**
 * 场景预设的推荐 core 参数
 *
 * 基于上游默认值（highDemandTimeWindow 15s / httpDownloadTimeWindow
 * 3s / p2pDownloadTimeWindow 6s）与场景语义推导的「推荐起点」，
 * 供用户在其上按实际带宽微调，并非普适最优解：
 * - live：直播消费即时性强、历史段无复用价值，拉长高需求窗口保障
 *   连续供给的调度提前量，并给 P2P 更多首发机会（时效内即可分发）
 * - vod：点播缓冲诉求更深且用户 seek 频繁，拉长高需求窗口提升
 *   缓冲深度，放宽 HTTP 窗口让位 P2P 首选、降低源站压力
 */
export const SCENE_PRESETS: Readonly<Record<ScenePresetName, Partial<CoreConfig>>> = {
  live: {
    highDemandTimeWindow: 30,
    p2pDownloadTimeWindow: 8000,
  },
  vod: {
    highDemandTimeWindow: 60,
    httpDownloadTimeWindow: 5000,
  },
}

/**
 * 插件 UI 文案的 i18n 键（中文原文即键）
 *
 * ArtPlayer 的 i18n.get 未命中时回退键本身，
 * 因此中文站点零配置即显示原文；其他语言经语言包注册生效
 */
export const I18N_KEY_P2P_ENABLED = 'P2P 加速'
export const I18N_KEY_UPLOAD_ONLY = '仅上传模式'
export const I18N_KEY_STATS = 'P2P 统计'
export const I18N_KEY_FATAL_NOTICE = 'P2P 加速恢复失败，已转为直连播放'

/** 右键统计面板的行标题（Peers 为通用术语不设键） */
export const I18N_KEY_PANEL_STATE = 'P2P 状态'
export const I18N_KEY_PANEL_DOWNLOAD = '下行速率'
export const I18N_KEY_PANEL_RATIO = 'P2P 占比'
export const I18N_KEY_PANEL_UPLOAD = '上行速率'
export const I18N_KEY_PANEL_TOTAL = '累计流量'

/** 右键统计面板状态行（「仅上传」与设置项「仅上传模式」是不同文案，独立键） */
export const I18N_KEY_STATE_RUNNING = '运行中'
export const I18N_KEY_STATE_UPLOAD_ONLY = '仅上传'
export const I18N_KEY_STATE_DISABLED = '已关闭'

/** 右上角徽章的节点数单位 */
export const I18N_KEY_PEERS_UNIT = '节点'

/**
 * 插件文案语言包类型
 *
 * 消息键为任意字符串（中文原文）；官方 I18n 类型的值键仅枚举
 * 内置 UI 文案，运行时的 update 深合并与 get 回退对任意键生效
 */
export type P2PI18nMessages = Partial<Record<string, Record<string, string>>>

/**
 * 插件自带语言包（经 art.i18n.update 深合并注册）
 *
 * 中文无需注册（键即原文）；宿主 option.lang 匹配注册语言时
 * 自动显示译文；宿主可在播放器创建后再次 update 覆写插件文案
 */
export const I18N_MESSAGES: P2PI18nMessages = {
  en: {
    [I18N_KEY_P2P_ENABLED]: 'P2P Acceleration',
    [I18N_KEY_UPLOAD_ONLY]: 'Upload Only',
    [I18N_KEY_STATS]: 'P2P Stats',
    [I18N_KEY_FATAL_NOTICE]: 'P2P recovery failed, switched to direct playback',
    [I18N_KEY_PANEL_STATE]: 'P2P State',
    [I18N_KEY_PANEL_DOWNLOAD]: 'Download',
    [I18N_KEY_PANEL_RATIO]: 'P2P Ratio',
    [I18N_KEY_PANEL_UPLOAD]: 'Upload',
    [I18N_KEY_PANEL_TOTAL]: 'Total Traffic',
    [I18N_KEY_STATE_RUNNING]: 'Running',
    [I18N_KEY_STATE_UPLOAD_ONLY]: 'Upload Only',
    [I18N_KEY_STATE_DISABLED]: 'Disabled',
    [I18N_KEY_PEERS_UNIT]: 'peers',
  },
}

/**
 * 统计带宽计算的滑动时间窗长度（毫秒）
 *
 * 直播切片通常 2-6s，10 秒窗口可平滑速率抖动
 */
export const BANDWIDTH_WINDOW_MS = 10_000

/** 统计心跳周期（毫秒），与 ArtPlayer 的 INFO_LOOP_TIME 对齐 */
export const STATS_POLLING_MS = 1000

/**
 * Core 事件到 ArtPlayer 自定义事件的映射表
 *
 * 键集合与 p2p-media-loader 的 CoreEventMap 完全一致，
 * 通过 satisfies 做编译期穷尽性检查：Core 新增事件或本表遗漏/多余键时
 * 构建直接失败，保证事件桥不丢失任何事件
 */
export const P2P_EVENT_BRIDGE_MAP = {
  onStreamAdded: 'p2p:streamAdded',
  onStreamRegistrationError: 'p2p:streamRegistrationError',
  onSegmentLoaded: 'p2p:segmentLoaded',
  onSegmentError: 'p2p:segmentError',
  onSegmentAbort: 'p2p:segmentAbort',
  onSegmentStart: 'p2p:segmentStart',
  onPeerConnect: 'p2p:peerConnect',
  onPeerConnectError: 'p2p:peerConnectError',
  onPeerClose: 'p2p:peerClose',
  onPeerError: 'p2p:peerError',
  onPeerWarning: 'p2p:peerWarning',
  onChunkDownloaded: 'p2p:chunkDownloaded',
  onChunkUploaded: 'p2p:chunkUploaded',
  onTrackerError: 'p2p:trackerError',
  onTrackerWarning: 'p2p:trackerWarning',
} as const satisfies Readonly<Record<keyof CoreEventMap, string>>
