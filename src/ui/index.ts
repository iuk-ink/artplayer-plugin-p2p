/**
 * UI 层聚合入口
 *
 * 按解析后的开关挂载组件（统计面板 + 右键菜单入口 / 设置开关组），
 * 并统一注册销毁清理。组件挂在 art 实例上而非引擎实例上：
 * 引擎重建与换源不影响 UI，统计重置后下一次轮询自然归零
 *
 * @module ui
 */

import type Artplayer from 'artplayer'
import type { P2PController } from '../controller'
import type { P2PStatsEngine } from '../stats'
import type { ResolvedOptions } from '../types'
import { injectStyles } from './styles'
import { mountStatsMenu, type StatsPanelHandle } from './stats-menu'
import { mountP2PSettings } from './setting'

/**
 * 挂载全部启用的 UI 组件
 *
 * 样式幂等注入（多播放器实例共用一份）；
 * 播放器 destroy 时组件 DOM 随之移除，定时器与
 * 事件监听在此处统一注销
 *
 * @param art - ArtPlayer 实例
 * @param controller - 生命周期控制器
 * @param stats - 统计引擎
 * @param options - 解析后的插件选项（消费 uiEnabled / statsEnabled / settingEnabled）
 */
export function mountUI(
  art: Artplayer,
  controller: P2PController,
  stats: P2PStatsEngine,
  options: ResolvedOptions,
): void {
  if (!options.uiEnabled) return

  injectStyles()

  let panel: StatsPanelHandle | null = null
  if (options.statsEnabled) {
    panel = mountStatsMenu(art, controller, stats)
  }

  if (options.settingEnabled) {
    mountP2PSettings(art, controller, panel, options.settingItems)
  }

  art.on('destroy', () => {
    panel?.destroy()
  })
}
