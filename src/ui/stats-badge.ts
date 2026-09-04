/**
 * 右上角 P2P 数据徽章（badge 渲染器）
 *
 * 轻量常显的单行速览组件：状态点（颜色表达运行中 / 仅上传 /
 * 已关闭）+ 上下行速率与节点数，与右键「P2P 统计」详情面板
 * 互不联动、可同屏（详情与速览互补）。挂载于
 * art.template.$player 右上角，显示期间订阅统计心跳，
 * 隐藏即退订（零后台开销）；显隐由设置面板「P2P 统计」
 * 开关项或句柄 setBadgeVisible 驱动
 *
 * @module ui/stats-badge
 */

import type Artplayer from 'artplayer'
import type { P2PController } from '../controller'
import type { StatsTicker } from '../stats-tick'
import type { P2PStats } from '../types/stats'
import { formatSpeed } from './format'

/** 显隐 class：挂在 $player 上，配合注入的显隐规则驱动徽章展示 */
const SHOW_CLASS = 'artp2p-badge-show'

/** 徽章结构模板：单行速览（状态点 + 数据文本） */
const BADGE_HTML = `
<div class="artp2p-badge">
  <span class="artp2p-badge-dot"></span>
  <span data-field="text"></span>
</div>
`

/** 徽章控制接口（供设置开关联动与句柄程序化控制使用） */
export interface StatsBadgeHandle {
  /** 显示徽章并订阅统计心跳 */
  show(): void
  /** 隐藏徽章并退订心跳 */
  hide(): void
  /** 徽章当前是否显示 */
  isVisible(): boolean
  /** 订阅显隐变化（show / hide 均会触发，供设置开关同步状态） */
  onVisibilityChange(callback: (visible: boolean) => void): void
  /** 卸载徽章（退订心跳；DOM 随播放器销毁清除） */
  destroy(): void
}

/**
 * 挂载右上角 P2P 数据徽章
 *
 * DOM 常驻（absolute 定位不占布局流），默认隐藏，
 * 由选项初始状态、设置开关项或句柄 setBadgeVisible 控制显示
 *
 * @param art - ArtPlayer 实例
 * @param controller - 生命周期控制器（读取开关状态）
 * @param ticker - 统计心跳（徽章显示期间订阅，数据由心跳推送）
 * @returns 徽章控制接口
 */
export function mountStatsBadge(
  art: Artplayer,
  controller: P2PController,
  ticker: StatsTicker,
): StatsBadgeHandle {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = BADGE_HTML
  const root = wrapper.firstElementChild as HTMLDivElement
  const text = root.querySelector<HTMLElement>('[data-field="text"]')!
  art.template.$player.appendChild(root)

  let visible = false
  let unsubscribe: (() => void) | undefined
  const visibilityCallbacks: Array<(visible: boolean) => void> = []

  /**
   * 刷新单行速览文本（显示期间由统计心跳驱动）
   *
   * P2P 关闭时上行与节点数恒为零，仅保留下行速率，
   * 避免零值噪音；仅上传模式下行为 0 属真实状态，保留展示
   */
  function update(snapshot: P2PStats): void {
    const p2pOn = controller.p2pEnabled
    root.dataset.state = !p2pOn ? 'off' : controller.uploadEnabled ? 'running' : 'upload-only'
    text.textContent = p2pOn
      ? `↓ ${formatSpeed(snapshot.downloadSpeed)} · ↑ ${formatSpeed(snapshot.uploadSpeed)} · ${snapshot.peers} 节点`
      : `↓ ${formatSpeed(snapshot.downloadSpeed)}`
  }

  function notifyVisibility(): void {
    for (const callback of visibilityCallbacks) callback(visible)
  }

  function showBadge(): void {
    if (visible) return
    visible = true
    art.template.$player.classList.add(SHOW_CLASS)
    unsubscribe = ticker.subscribe(update)
    notifyVisibility()
  }

  function hideBadge(): void {
    if (!visible) return
    visible = false
    art.template.$player.classList.remove(SHOW_CLASS)
    unsubscribe?.()
    unsubscribe = undefined
    notifyVisibility()
  }

  return {
    show: showBadge,
    hide: hideBadge,
    isVisible: () => visible,
    onVisibilityChange(callback) {
      visibilityCallbacks.push(callback)
    },
    destroy() {
      hideBadge()
    },
  }
}
