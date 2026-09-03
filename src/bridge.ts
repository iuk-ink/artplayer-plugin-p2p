/**
 * 事件桥
 *
 * 将 P2P 引擎事件转发为 ArtPlayer 自定义事件（p2p:* 前缀），
 * 并驱动统计引擎累加；监听器绑定在引擎实例上，随实例销毁释放。
 * 动态开关切换不销毁引擎实例，事件桥因此全程持续有效
 *
 * @module bridge
 */

import type Artplayer from 'artplayer'
import type { HlsJsP2PEngine } from 'p2p-media-loader-hlsjs'
import type { P2PStatsEngine } from './stats'
import { P2P_EVENT_BRIDGE_MAP } from './constants'

/** 弱类型事件订阅函数（映射表遍历时键为动态字符串，无法保有泛型签名） */
type LooseEventListener = (name: string, listener: (...args: unknown[]) => void) => void

/**
 * 将 P2P 引擎事件桥接为 ArtPlayer 自定义事件并驱动统计引擎
 *
 * 每个引擎事件以 p2p:* 前缀原样转发（参数透传，宿主按事件名消费）；
 * 流量与 peer 连接事件同时喂给统计引擎。
 * 同一事件（如 onPeerConnect）会被转发与统计分别订阅，
 * 两个监听器互不干扰
 *
 * @param art - ArtPlayer 实例
 * @param engine - HlsJsP2PEngine 引擎实例
 * @param stats - 统计引擎实例
 */
export function attachEventBridge(
  art: Artplayer,
  engine: HlsJsP2PEngine,
  stats: P2PStatsEngine,
): void {
  // 泛型 addEventListener 无法直接接受动态键，此处放宽为弱类型订阅
  const subscribe = engine.addEventListener.bind(engine) as unknown as LooseEventListener

  for (const [eventName, artEventName] of Object.entries(P2P_EVENT_BRIDGE_MAP)) {
    subscribe(eventName, (...args: unknown[]) => {
      art.emit(artEventName, ...args)
    })
  }

  // 流量统计：按下载通道分别累加
  engine.addEventListener('onChunkDownloaded', (bytesLength, downloadSource) => {
    stats.recordDownload(bytesLength, downloadSource)
  })
  engine.addEventListener('onChunkUploaded', (bytesLength) => {
    stats.recordUpload(bytesLength)
  })

  // peer 连接统计
  engine.addEventListener('onPeerConnect', () => {
    stats.recordPeerConnect()
  })
  engine.addEventListener('onPeerClose', () => {
    stats.recordPeerClose()
  })
}
