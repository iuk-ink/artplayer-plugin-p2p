/**
 * 纯逻辑聚合入口
 *
 * 聚合无浏览器依赖的模块（常量 / 配置合并 / 带宽 / 统计），
 * 供 Node 环境直接加载与测试；浏览器集成请使用主入口
 *
 * @module pure
 */

export {
  P2P_EVENT_BRIDGE_MAP,
  DEFAULT_TYPE,
  DEFAULT_FATAL_RETRY_MAX,
  BANDWIDTH_WINDOW_MS,
  STATS_POLLING_MS,
} from './constants'
export { resolveOptions, mergeCoreConfig, applyRuntimeToggle } from './config'
export { BandwidthCalculator } from './bandwidth'
export { P2PStatsEngine } from './stats'
export type {
  P2POptions,
  P2PTrackerOptions,
  P2PUIOptions,
  P2PSettingItemsOptions,
  P2PPluginHandle,
  P2PStats,
  DownloadChannel,
  StateChangeDetails,
  CoreConfig,
  DynamicCoreConfig,
} from './types'
