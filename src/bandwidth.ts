/**
 * 滑动时间窗带宽计算器
 *
 * 纯逻辑实现：时间源可注入（timestampMs 参数），缺省取
 * performance.now()（单调时钟，与 p2pml 官方带宽计算一致，
 * 不受系统时钟跳变影响），测试可注入固定时间戳
 *
 * @module bandwidth
 */

/** 单笔字节样本（时间戳 + 字节数） */
interface ByteSample {
  timestampMs: number
  bytes: number
}

/**
 * 滑动时间窗带宽计算器
 *
 * 每笔字节记录为独立样本，读取速率时惰性清理窗口外样本；
 * 样本量与窗口内的 chunk 频次成正比（直播场景上限约数百个），无需主动压缩
 */
export class BandwidthCalculator {
  readonly #windowMs: number
  readonly #samples: ByteSample[] = []

  /**
   * @param windowMs - 滑动时间窗长度（毫秒），窗口越长速率越平滑
   */
  constructor(windowMs: number) {
    this.#windowMs = windowMs
  }

  /**
   * 记录一笔字节
   *
   * @param bytes - 字节数（非正值直接忽略，防御脏数据）
   * @param timestampMs - 样本时间戳；缺省取 performance.now()，测试可注入固定时间
   */
  record(bytes: number, timestampMs: number = performance.now()): void {
    if (bytes <= 0) return
    this.#samples.push({ timestampMs, bytes })
  }

  /**
   * 计算窗口内平均速率
   *
   * 读取时惰性清理过期样本；速率按整个窗口长度折算而非
   * 首尾样本间隔，保证窗口未填满时（刚启动）读数平滑趋近真实值
   *
   * @param nowMs - 当前时间戳；缺省取 performance.now()，测试可注入固定时间
   * @returns 速率 B/s
   */
  getSpeed(nowMs: number = performance.now()): number {
    this.#removeExpired(nowMs)
    let totalBytes = 0
    for (const sample of this.#samples) {
      totalBytes += sample.bytes
    }
    return totalBytes / (this.#windowMs / 1000)
  }

  /** 清空全部样本 */
  reset(): void {
    this.#samples.length = 0
  }

  /**
   * 移除窗口外的过期样本
   *
   * 样本时间戳单调递增（缺省时间源 performance.now 单调；
   * 注入时间戳同样须单调），从头扫描至首个窗口内样本即可。
   * 边界样本（age 恰等于窗口长）保留在窗口内，与 p2pml
   * 官方带宽计算的过期判定语义保持一致
   */
  #removeExpired(nowMs: number): void {
    const cutoff = nowMs - this.#windowMs
    let firstValid = this.#samples.length
    for (let i = 0; i < this.#samples.length; i++) {
      if (this.#samples[i].timestampMs >= cutoff) {
        firstValid = i
        break
      }
    }
    this.#samples.splice(0, firstValid)
  }
}
