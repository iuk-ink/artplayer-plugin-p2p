/**
 * 右上角 P2P 数据徽章（badge 渲染器）
 *
 * 轻量常显的单行速览组件：状态点（颜色表达运行中 / 仅上传 /
 * 已关闭）+ 上下行速率与节点数，与右键「P2P 统计」详情面板
 * 互不联动、可同屏（速览与详查互补）。点击徽章原地展开三行
 * 轻量详情（Peers 峰值 / P2P 占比 / 累计流量），高度经 grid
 * 行轨道过渡实现丝滑展开；显隐与展开为正交两态，隐藏时强制
 * 收起（隐藏期间心跳退订数据停更，展开态会陈旧）。
 * 挂载于 art.template.$player 右上角，显示期间订阅统计心跳，
 * 隐藏即退订（零后台开销）；显隐由设置面板「P2P 统计」
 * 开关项或句柄 setBadgeVisible 驱动
 *
 * @module ui/stats-badge
 */

import type Artplayer from 'artplayer'
import type { P2PController } from '../controller'
import type { StatsTicker } from '../stats-tick'
import type { P2PStats } from '../types/stats'
import { I18N_KEY_PEERS_UNIT, I18N_KEY_PANEL_RATIO, I18N_KEY_PANEL_TOTAL } from '../constants'
import { formatBytes, formatPercent, formatSpeed } from './format'

/** 显隐 class：挂在 $player 上，配合注入的显隐规则驱动徽章展示 */
const SHOW_CLASS = 'artp2p-badge-show'

/** 展开态 class：挂在徽章根上，驱动详情区的 grid 高度过渡 */
const EXPANDED_CLASS = 'artp2p-badge-expanded'

/**
 * 徽章结构模板：速览行（状态点 + 数据文本）+ 可展开详情区
 *
 * 详情区为 grid 行轨道容器（0fr ↔ 1fr 过渡驱动高度动画），
 * 内层 overflow hidden 承载三行详情；行 label 为静态文案
 * （挂载时经 i18n 解析一次），数值单元格由统计心跳刷新
 */
const BADGE_HTML = `
<div class="artp2p-badge" role="button" aria-expanded="false" tabindex="0">
  <div class="artp2p-badge-summary">
    <span class="artp2p-badge-dot"></span>
    <span data-field="text"></span>
  </div>
  <div class="artp2p-badge-details">
    <div class="artp2p-badge-details-inner">
      <div class="artp2p-badge-detail-row"><span data-field="detail-peers-label">Peers</span><span data-field="detail-peers"></span></div>
      <div class="artp2p-badge-detail-row"><span data-field="detail-ratio-label"></span><span data-field="detail-ratio"></span></div>
      <div class="artp2p-badge-detail-row"><span data-field="detail-total-label"></span><span data-field="detail-total"></span></div>
    </div>
  </div>
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
  const detailFields = {
    peers: root.querySelector<HTMLElement>('[data-field="detail-peers"]')!,
    ratio: root.querySelector<HTMLElement>('[data-field="detail-ratio"]')!,
    total: root.querySelector<HTMLElement>('[data-field="detail-total"]')!,
  }
  // 详情行 label 挂载时经 i18n 解析一次（与设置项 / 面板标题同时机）
  root.querySelector<HTMLElement>('[data-field="detail-ratio-label"]')!.textContent
    = art.i18n.get(I18N_KEY_PANEL_RATIO)
  root.querySelector<HTMLElement>('[data-field="detail-total-label"]')!.textContent
    = art.i18n.get(I18N_KEY_PANEL_TOTAL)
  art.template.$player.appendChild(root)

  let visible = false
  let expanded = false
  let unsubscribe: (() => void) | undefined
  const visibilityCallbacks: Array<(visible: boolean) => void> = []

  /** 切换展开态：class 驱动 CSS grid 高度过渡，aria 同步供辅助技术感知 */
  function toggleExpanded(): void {
    expanded = !expanded
    root.classList.toggle(EXPANDED_CLASS, expanded)
    root.setAttribute('aria-expanded', String(expanded))
  }

  /** 收起展开态（隐藏徽章时调用：隐藏期间心跳停更，展开态会陈旧） */
  function collapse(): void {
    if (expanded) toggleExpanded()
  }

  /**
   * 刷新速览行与详情区数值（显示期间由统计心跳驱动）
   *
   * P2P 关闭时上行与节点数恒为零，速览仅保留下行速率、
   * 占比置为占位符，避免零值噪音；仅上传模式下上行 0
   * 属真实状态，保留展示
   */
  function update(snapshot: P2PStats): void {
    const p2pOn = controller.p2pEnabled
    root.dataset.state = !p2pOn ? 'off' : controller.uploadEnabled ? 'running' : 'upload-only'
    text.textContent = p2pOn
      ? `↓ ${formatSpeed(snapshot.downloadSpeed)} · ↑ ${formatSpeed(snapshot.uploadSpeed)} · ${snapshot.peers} ${art.i18n.get(I18N_KEY_PEERS_UNIT)}`
      : `↓ ${formatSpeed(snapshot.downloadSpeed)}`
    detailFields.peers.textContent = `${snapshot.peers} / ${snapshot.peakPeers}`
    detailFields.ratio.textContent = p2pOn ? formatPercent(snapshot.p2pDownloadRatio) : '—'
    detailFields.total.textContent = `↓ ${formatBytes(snapshot.totalDownloadedBytes)} · ↑ ${formatBytes(snapshot.uploadedBytes)}`
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
    collapse()
    art.template.$player.classList.remove(SHOW_CLASS)
    unsubscribe?.()
    unsubscribe = undefined
    notifyVisibility()
  }

  // 点击 / 键盘激活展开切换：stopPropagation 阻断冒泡，点击与按键
  // 均不得穿透到播放器容器（触发播放暂停）或 window（hotkey 空格）
  const onBadgeClick = (event: Event): void => {
    event.stopPropagation()
    toggleExpanded()
  }
  const onBadgeKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    toggleExpanded()
  }
  root.addEventListener('click', onBadgeClick)
  root.addEventListener('keydown', onBadgeKeyDown)

  return {
    show: showBadge,
    hide: hideBadge,
    isVisible: () => visible,
    onVisibilityChange(callback) {
      visibilityCallbacks.push(callback)
    },
    destroy() {
      hideBadge()
      root.removeEventListener('click', onBadgeClick)
      root.removeEventListener('keydown', onBadgeKeyDown)
    },
  }
}
