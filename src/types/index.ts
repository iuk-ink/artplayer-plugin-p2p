/**
 * 类型契约聚合出口
 *
 * 仅聚合对外发布的公共类型；内部类型（ResolvedOptions / EngineOptions）
 * 由各消费模块从 './types/internal' 直接导入，不经此处
 *
 * @module types
 */

export type {
  P2POptions,
  P2PTrackerOptions,
  P2PUIOptions,
  P2PSettingItemsOptions,
  ScenePresetName,
} from './options'
export type { P2PPluginHandle, P2PPluginFactory, DynamicCoreConfig } from './handle'
export type { StateChangeDetails } from './events'
export type { P2PStats, DownloadChannel } from './stats'
export type { CoreConfig } from 'p2p-media-loader-core'
