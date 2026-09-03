/**
 * P2P 统计引擎
 *
 * 累加器 + 三个带宽通道（P2P 下行 / HTTP 下行 / 上行）+ 派生指标；
 * 由事件桥喂点，对外提供快照读取与重置。
 * 纯逻辑实现：不触碰任何播放器与引擎状态，Node 可直接单测
 *
 * @module stats
 */

import { BandwidthCalculator } from './bandwidth'
import { BANDWIDTH_WINDOW_MS } from './constants'
import type { DownloadChannel, P2PStats } from './types'

/** P2P 统计引擎 */
export class P2PStatsEngine {
  #peers = 0
  #peakPeers = 0
  #p2pDownloadedBytes = 0
  #httpDownloadedBytes = 0
  #uploadedBytes = 0

  readonly #downloadBandwidths: Record<DownloadChannel, BandwidthCalculator> = {
    p2p: new BandwidthCalculator(BANDWIDTH_WINDOW_MS),
    http: new BandwidthCalculator(BANDWIDTH_WINDOW_MS),
  }
  readonly #uploadBandwidth = new BandwidthCalculator(BANDWIDTH_WINDOW_MS)

  /** 记录一个 peer 连接建立（同时维护峰值） */
  recordPeerConnect(): void {
    this.#peers += 1
    if (this.#peers > this.#peakPeers) {
      this.#peakPeers = this.#peers
    }
  }

  /** 记录一个 peer 连接断开（计数不小于零） */
  recordPeerClose(): void {
    if (this.#peers > 0) {
      this.#peers -= 1
    }
  }

  /**
   * 记录一笔下行字节
   *
   * @param bytes - 字节数
   * @param channel - 下载通道（http / p2p）
   * @param timestampMs - 样本时间戳；缺省取 performance.now()，测试可注入固定时间
   */
  recordDownload(bytes: number, channel: DownloadChannel, timestampMs?: number): void {
    if (bytes <= 0) return
    if (channel === 'p2p') {
      this.#p2pDownloadedBytes += bytes
    } else {
      this.#httpDownloadedBytes += bytes
    }
    this.#downloadBandwidths[channel].record(bytes, timestampMs)
  }

  /**
   * 记录一笔 P2P 上行字节
   *
   * @param bytes - 字节数
   * @param timestampMs - 样本时间戳；缺省取 performance.now()，测试可注入固定时间
   */
  recordUpload(bytes: number, timestampMs?: number): void {
    if (bytes <= 0) return
    this.#uploadedBytes += bytes
    this.#uploadBandwidth.record(bytes, timestampMs)
  }

  /**
   * 输出当前统计快照（累计量 + 派生指标一次算清）
   *
   * 带宽基准时间只取一次、每通道只计算一次，
   * 保证快照内部指标自洽（downloadSpeed 恒等于两通道之和）
   *
   * @param nowMs - 带宽计算基准时间戳；缺省取 performance.now()，测试可注入固定时间
   */
  snapshot(nowMs?: number): P2PStats {
    const totalDownloadedBytes = this.#p2pDownloadedBytes + this.#httpDownloadedBytes
    const now = nowMs ?? performance.now()
    const p2pDownloadSpeed = this.#downloadBandwidths.p2p.getSpeed(now)
    const httpDownloadSpeed = this.#downloadBandwidths.http.getSpeed(now)
    return {
      peers: this.#peers,
      peakPeers: this.#peakPeers,
      p2pDownloadedBytes: this.#p2pDownloadedBytes,
      httpDownloadedBytes: this.#httpDownloadedBytes,
      uploadedBytes: this.#uploadedBytes,
      totalDownloadedBytes,
      p2pDownloadRatio: totalDownloadedBytes > 0 ? this.#p2pDownloadedBytes / totalDownloadedBytes : 0,
      downloadSpeed: p2pDownloadSpeed + httpDownloadSpeed,
      p2pDownloadSpeed,
      uploadSpeed: this.#uploadBandwidth.getSpeed(now),
    }
  }

  /**
   * 清零当前 peer 计数
   *
   * 动态关闭 P2P 或销毁播放实例后连接已全部断开（引擎销毁不保证
   * 逐个发出 onPeerClose），主动清零防止残留计数污染下一次快照；
   * 峰值与字节累计保留
   */
  resetPeers(): void {
    this.#peers = 0
  }

  /** 重置全部计数与样本（换源时调用） */
  reset(): void {
    this.#peers = 0
    this.#peakPeers = 0
    this.#p2pDownloadedBytes = 0
    this.#httpDownloadedBytes = 0
    this.#uploadedBytes = 0
    this.#downloadBandwidths.p2p.reset()
    this.#downloadBandwidths.http.reset()
    this.#uploadBandwidth.reset()
  }
}
