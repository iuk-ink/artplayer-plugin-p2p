/**
 * 插件配置解析与合并逻辑
 *
 * 独立于引擎模块的纯函数集合，可在 Node 环境直接测试：
 * - resolveOptions：归一化插件选项（默认值合并、stats / ui / badge 降级兼容）
 * - mergeCoreConfig：合并 core 配置与 tracker 快捷配置组
 * - applyRuntimeToggle：将插件运行时开关状态注入 core 配置
 *
 * @module config
 */

import type { CoreConfig } from 'p2p-media-loader-core'
import { DEFAULT_FATAL_RETRY_MAX, DEFAULT_TYPE } from './constants'
import type { P2POptions, P2PSettingItemsOptions, P2PUIOptions } from './types/options'
import type { ResolvedOptions } from './types/internal'

/**
 * 解析对象形式的 ui 配置
 *
 * setting 未配置视为开启（仍受宿主 option.setting 门控）
 *
 * @param ui - 用户传入的 ui 对象
 * @returns 设置开关组挂载开关
 */
function resolveUIOptions(ui: P2PUIOptions): boolean {
  return ui.setting !== false
}

/**
 * 解析设置开关组的单项显示配置
 *
 * - true / 省略：三项全显
 * - false：全部隐藏（等效整组不挂载）
 * - 对象：按项解析，未指定的项默认显示
 *
 * @param setting - 用户传入的 setting 配置
 * @returns 三项显示开关（已含默认值）
 */
function resolveSettingItems(
  setting: boolean | P2PSettingItemsOptions | undefined,
): P2PSettingItemsOptions {
  if (setting === undefined || setting === true) {
    return { p2pEnabled: true, uploadOnly: true, stats: true }
  }
  if (setting === false) {
    return { p2pEnabled: false, uploadOnly: false, stats: false }
  }
  return {
    p2pEnabled: setting.p2pEnabled ?? true,
    uploadOnly: setting.uploadOnly ?? true,
    stats: setting.stats ?? true,
  }
}

/**
 * 解析插件选项：填充默认值并归一化 stats / ui / badge 开关
 *
 * 仅做归一化，不修改任何透传配置的内容；
 * core / tracker / hls 原样保留给引擎层合并
 *
 * @param options - 用户传入的插件选项
 * @returns 下游模块可直接消费的解析后选项
 */
export function resolveOptions(options: P2POptions): ResolvedOptions {
  const uiEnabled = options.ui !== false

  let settingEnabled: boolean
  let settingItems: P2PSettingItemsOptions
  if (typeof options.ui === 'object' && options.ui !== null) {
    settingEnabled = resolveUIOptions(options.ui)
    settingItems = resolveSettingItems(options.ui.setting)
  } else {
    settingEnabled = uiEnabled
    settingItems = resolveSettingItems(uiEnabled ? undefined : false)
  }

  return {
    typeName: options.type ?? DEFAULT_TYPE,
    fatalRetryMax: options.fatalRetryMax ?? DEFAULT_FATAL_RETRY_MAX,
    fatalNotice: options.fatalNotice === true,
    p2pEnabled: options.enabled ?? true,
    uploadEnabled: options.uploadEnabled ?? true,
    uiEnabled,
    statsEnabled: uiEnabled && options.stats !== false,
    badgeEnabled: uiEnabled && options.stats !== false && options.badge === true,
    settingEnabled,
    settingItems,
    core: options.core,
    tracker: options.tracker,
    hls: options.hls,
  }
}

/**
 * 合并 core 配置与 tracker 快捷配置组
 *
 * tracker 组字段与 CoreConfig 同名，浅合并且优先级高于 core；
 * 两组皆未配置时返回空对象，保持 p2p-media-loader 官方默认行为
 *
 * @param options - 含 core / tracker 配置的选项（结构化子集即可）
 * @returns 传给 HlsJsP2PEngine 的 core 配置
 */
export function mergeCoreConfig(
  options: Pick<P2POptions, 'core' | 'tracker'>,
): Partial<CoreConfig> {
  return { ...options.core, ...options.tracker }
}

/**
 * 将插件运行时开关状态注入 core 配置
 *
 * isP2PDisabled / isP2PUploadDisabled 由插件开关状态接管
 * （最高优先级）：保证 fatal 重建、换源、重连后重建的实例
 * 携带与用户当前选择一致的模式，不因重建而静默丢失开关状态；
 * 宿主表达初始意图应使用 enabled / uploadEnabled 选项
 *
 * @param config - mergeCoreConfig 合并后的 core 配置
 * @param p2pEnabled - 当前 P2P 开关状态
 * @param uploadEnabled - 当前上传开关状态
 * @returns 注入开关状态后的 core 配置
 */
export function applyRuntimeToggle(
  config: Partial<CoreConfig>,
  p2pEnabled: boolean,
  uploadEnabled: boolean,
): Partial<CoreConfig> {
  return {
    ...config,
    isP2PDisabled: !p2pEnabled,
    isP2PUploadDisabled: !uploadEnabled,
  }
}
