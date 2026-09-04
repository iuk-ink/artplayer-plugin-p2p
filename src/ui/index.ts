/**
 * UI 层聚合入口
 *
 * 按解析后的开关挂载组件（右键统计面板 / 右上角数据徽章 /
 * 设置开关组），并统一注册销毁清理。组件挂在 art 实例上
 * 而非引擎实例上：引擎重建与换源不影响 UI，统计重置后
 * 下一次心跳自然归零
 *
 * @module ui
 */

import type Artplayer from 'artplayer'
import type { P2PController } from '../controller'
import type { StatsTicker } from '../stats-tick'
import type { ResolvedOptions } from '../types/internal'
import { log } from '../debug'
import { injectStyles } from './styles'
import { mountStatsMenu, type StatsPanelHandle } from './stats-menu'
import { mountStatsBadge, type StatsBadgeHandle } from './stats-badge'
import { mountP2PSettings } from './setting'

/**
 * 挂载全部启用的 UI 组件
 *
 * 样式幂等注入（多播放器实例共用一份）；
 * 播放器 destroy 时组件 DOM 随之移除，定时器与
 * 事件监听在此处统一注销。
 * 每个装配决策（挂载 / 跳过及其原因）均输出调试日志，
 * 经 artplayerPluginP2P.DEBUG 开启后可用于追踪 UI 装配链路
 *
 * @param art - ArtPlayer 实例
 * @param controller - 生命周期控制器
 * @param ticker - 统计心跳（渲染器共享的数据源）
 * @param options - 解析后的插件选项（消费 uiEnabled / statsEnabled / badgeEnabled / settingEnabled）
 * @returns 右上角数据徽章控制接口（供句柄程序化控制；无 UI 或统计总闸关闭时为 null）
 */
export function mountUI(
  art: Artplayer,
  controller: P2PController,
  ticker: StatsTicker,
  options: ResolvedOptions,
): StatsBadgeHandle | null {
  if (!options.uiEnabled) {
    log('ui skipped (ui: false)')
    return null
  }

  injectStyles()

  let panel: StatsPanelHandle | null = null
  let badge: StatsBadgeHandle | null = null
  if (options.statsEnabled) {
    panel = mountStatsMenu(art, controller, ticker)
    log('stats panel mounted (contextmenu entry included)')
    badge = mountStatsBadge(art, controller, ticker)
    if (options.badgeEnabled) {
      badge.show()
      log('badge initially visible (badge: true)')
    } else {
      log('badge mounted hidden')
    }
  } else {
    log('stats UI skipped (stats: false)')
  }

  if (options.settingEnabled) {
    const mounted = mountP2PSettings(art, controller, badge, options.settingItems)
    log(mounted ? 'setting items mounted' : 'setting items all hidden')
  } else {
    log('setting group skipped (ui.setting false)')
  }

  art.on('destroy', () => {
    panel?.destroy()
    badge?.destroy()
  })

  return badge
}
