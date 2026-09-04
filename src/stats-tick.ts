/**
 * 统计心跳：单一 1Hz 定时器 + 订阅计数驱动启停
 *
 * 同一份统计数据存在多条消费路径（右键详情面板 / 右上角徽章 /
 * 宿主 headless 消费），心跳将 N 条独立轮询归一为全局一份定时器：
 * 首个订阅者出现时启动，最后一个订阅者离开即停；
 * 播放器销毁时 destroy() 清空全部订阅并停表。
 * 定时器经 globalThis 调用（Node headless 场景同样可用）
 *
 * @module stats-tick
 */

import type { P2PStatsEngine } from './stats'
import type { P2PStats } from './types/stats'

/** 统计心跳回调：每个周期收到一次统计快照 */
export type StatsTickCallback = (snapshot: P2PStats) => void

/**
 * 统计心跳驱动器
 *
 * 由入口层创建（持有统计引擎与轮询周期），装配层与句柄
 * 共享同一实例；订阅 / 退订即为渲染器的启停开关
 */
export class StatsTicker {
  readonly #engine: P2PStatsEngine
  readonly #intervalMs: number
  readonly #subscribers = new Set<StatsTickCallback>()
  #timer: ReturnType<typeof setInterval> | undefined

  /**
   * @param engine - 统计引擎（快照数据源）
   * @param intervalMs - 心跳周期（毫秒）
   */
  constructor(engine: P2PStatsEngine, intervalMs: number) {
    this.#engine = engine
    this.#intervalMs = intervalMs
  }

  /**
   * 订阅统计心跳（首个订阅者启动定时器）
   *
   * 订阅即同步送达一次当前快照：渲染器与 headless 消费者
   * 无需等待下一个心跳周期即可完成首帧渲染
   *
   * @param callback - 心跳回调
   * @returns 取消订阅函数（最后一个订阅者退订时停止定时器）
   */
  subscribe(callback: StatsTickCallback): () => void {
    this.#subscribers.add(callback)
    this.#ensureTimer()
    callback(this.#engine.snapshot())
    return () => {
      this.#subscribers.delete(callback)
      if (this.#subscribers.size === 0) {
        this.#stopTimer()
      }
    }
  }

  /** 清空全部订阅并停止定时器（播放器销毁时调用） */
  destroy(): void {
    this.#subscribers.clear()
    this.#stopTimer()
  }

  #ensureTimer(): void {
    if (this.#timer !== undefined) return
    this.#timer = setInterval(() => this.#tick(), this.#intervalMs)
  }

  #stopTimer(): void {
    if (this.#timer === undefined) return
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  #tick(): void {
    const snapshot = this.#engine.snapshot()
    for (const callback of this.#subscribers) {
      callback(snapshot)
    }
  }
}
