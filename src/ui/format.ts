/**
 * UI 层数值格式化工具
 *
 * @module ui/format
 */

/**
 * 格式化字节数为可读字符串
 *
 * @param bytes - 字节数
 * @returns 如 "1.2 MB" 的可读文本
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${Math.round(bytes)} B`
}

/**
 * 格式化速率为可读字符串
 *
 * @param bytesPerSecond - 速率 B/s
 * @returns 如 "1.2 MB/s" 的可读文本
 */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

/**
 * 格式化 P2P 占比为百分比文本
 *
 * @param ratio - 占比 0..1
 * @returns 如 "72%" 的文本
 */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
