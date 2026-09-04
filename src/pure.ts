/**
 * 纯逻辑聚合入口
 *
 * 聚合无浏览器 DOM 依赖的模块（常量 / 配置合并 / 带宽 / 统计 /
 * 统计心跳），供 Node 环境直接加载与测试；浏览器集成请使用主入口
 *
 * @module pure
 */

export {
  P2P_EVENT_BRIDGE_MAP,
  DEFAULT_TYPE,
  DEFAULT_FATAL_RETRY_MAX,
  BANDWIDTH_WINDOW_MS,
  STATS_POLLING_MS,
  SCENE_PRESETS,
} from './constants'
export { resolveOptions, mergeCoreConfig, applyRuntimeToggle, applyScenePreset } from './config'
export { BandwidthCalculator } from './bandwidth'
export { P2PStatsEngine } from './stats'
export { StatsTicker } from './stats-tick'
export type { StatsTickCallback } from './stats-tick'
export type {
  P2POptions,
  P2PTrackerOptions,
  P2PUIOptions,
  P2PSettingItemsOptions,
  P2PPluginHandle,
  P2PPluginFactory,
  P2PStats,
  DownloadChannel,
  StateChangeDetails,
  DynamicCoreConfig,
  CoreConfig,
  ScenePresetName,
} from './types/index'
