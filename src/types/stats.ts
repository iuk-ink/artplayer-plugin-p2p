/**
 * 统计快照类型契约
 *
 * @module types/stats
 */

import type { DownloadSource } from 'p2p-media-loader-core'

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

/** 下载通道类型（别名自 p2p-media-loader 的 DownloadSource，随上游保持同步） */
export type DownloadChannel = DownloadSource
