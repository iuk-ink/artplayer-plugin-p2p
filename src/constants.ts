/**
 * 插件常量定义
 *
 * @module constants
 */

import type { CoreEventMap } from 'p2p-media-loader-core'

/** customType 注册的默认格式名 */
export const DEFAULT_TYPE = 'm3u8'

/** fatal 错误销毁重建的默认最大次数 */
export const DEFAULT_FATAL_RETRY_MAX = 2

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
