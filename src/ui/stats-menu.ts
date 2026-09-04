/**
 * 右键菜单「P2P 统计」项与独立 P2P 详情面板（panel 渲染器）
 *
 * 面板为 P2P 完整指标的唯一展示面：容器复用官方 art-info class
 * （art-info artp2p-info 双类）实现与「统计信息」面板的视觉同构，
 * 挂载于 art.template.$player 与原生面板同级同位。
 * 数据来自统计心跳订阅（显示时订阅、隐藏即退订，零后台开销）
 *
 * @module ui/stats-menu
 */

import type Artplayer from 'artplayer'
import type { P2PController } from '../controller'
import type { P2PStatsEngine } from '../stats'
import type { StatsTicker } from '../stats-tick'
import {
  I18N_KEY_PANEL_DOWNLOAD,
  I18N_KEY_PANEL_RATIO,
  I18N_KEY_PANEL_STATE,
  I18N_KEY_PANEL_TOTAL,
  I18N_KEY_PANEL_UPLOAD,
  I18N_KEY_STATE_DISABLED,
  I18N_KEY_STATE_RUNNING,
  I18N_KEY_STATE_UPLOAD_ONLY,
  I18N_KEY_STATS,
} from '../constants'
import { formatBytes, formatPercent, formatSpeed } from './format'

/** 右键菜单项挂载名 */
const CONTEXTMENU_NAME = 'artp2pStats'

/** 显隐 class：挂在 $player 上，配合注入的显隐规则驱动面板展示 */
const SHOW_CLASS = 'artp2p-stats-show'

/**
 * 构建面板结构：行标题在挂载时经 i18n 解析（与设置项同为创建时
 * 解析一次，运行中换语言需重建播放器）；冒号不入键，模板统一拼接
 *
 * @param art - ArtPlayer 实例
 * @returns 面板根节点 HTML
 */
function buildPanelHtml(art: Artplayer): string {
  return `
<div class="art-info artp2p-info">
  <div class="art-info-panel">
    <div class="art-info-item">
      <div class="art-info-title">${art.i18n.get(I18N_KEY_PANEL_STATE)}:</div>
      <div class="art-info-content" data-field="state"></div>
    </div>
    <div class="art-info-item">
      <div class="art-info-title">${art.i18n.get(I18N_KEY_PANEL_DOWNLOAD)}:</div>
      <div class="art-info-content" data-field="download"></div>
    </div>
    <div class="art-info-item">
      <div class="art-info-title">${art.i18n.get(I18N_KEY_PANEL_RATIO)}:</div>
      <div class="art-info-content" data-field="ratio"></div>
    </div>
    <div class="art-info-item">
      <div class="art-info-title">${art.i18n.get(I18N_KEY_PANEL_UPLOAD)}:</div>
      <div class="art-info-content" data-field="upload"></div>
    </div>
    <div class="art-info-item">
      <div class="art-info-title">Peers:</div>
      <div class="art-info-content" data-field="peers"></div>
    </div>
    <div class="art-info-item">
      <div class="art-info-title">${art.i18n.get(I18N_KEY_PANEL_TOTAL)}:</div>
      <div class="art-info-content" data-field="total"></div>
    </div>
  </div>
  <div class="art-info-close">[x]</div>
</div>
`
}

/** 面板控制接口（供设置开关联动与统一卸载使用） */
export interface StatsPanelHandle {
  /** 打开面板并订阅统计心跳（同时关闭原生「统计信息」面板） */
  open(): void
  /** 隐藏面板并退订心跳 */
  close(): void
  /** 面板当前是否显示 */
  isOpen(): boolean
  /** 订阅显隐变化（[x] 关闭与 open/close 均会触发，供设置开关同步状态） */
  onVisibilityChange(callback: (open: boolean) => void): void
  /** 卸载面板（退订心跳并移除事件监听；DOM 随播放器销毁清除） */
  destroy(): void
}

/**
 * 依据开关状态解析面板状态行文本
 *
 * @param art - ArtPlayer 实例（状态文案经 i18n 解析）
 * @param controller - 生命周期控制器（读取 P2P / 上传开关）
 * @returns 运行中 / 仅上传 / 已关闭（按宿主语言）
 */
function resolveStateText(art: Artplayer, controller: P2PController): string {
  if (!controller.p2pEnabled) return art.i18n.get(I18N_KEY_STATE_DISABLED)
  if (!controller.uploadEnabled) return art.i18n.get(I18N_KEY_STATE_UPLOAD_ONLY)
  return art.i18n.get(I18N_KEY_STATE_RUNNING)
}

/**
 * 挂载右键菜单「P2P 统计」项与独立 P2P 面板
 *
 * @param art - ArtPlayer 实例
 * @param controller - 生命周期控制器（读取开关状态）
 * @param ticker - 统计心跳（面板显示期间订阅，数据由心跳推送）
 * @returns 面板控制接口
 */
export function mountStatsMenu(
  art: Artplayer,
  controller: P2PController,
  ticker: StatsTicker,
): StatsPanelHandle {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = buildPanelHtml(art)
  const root = wrapper.firstElementChild as HTMLDivElement
  const fields = {
    state: root.querySelector<HTMLElement>('[data-field="state"]')!,
    download: root.querySelector<HTMLElement>('[data-field="download"]')!,
    ratio: root.querySelector<HTMLElement>('[data-field="ratio"]')!,
    upload: root.querySelector<HTMLElement>('[data-field="upload"]')!,
    peers: root.querySelector<HTMLElement>('[data-field="peers"]')!,
    total: root.querySelector<HTMLElement>('[data-field="total"]')!,
  }
  const $close = root.querySelector<HTMLElement>('.art-info-close')!
  art.template.$player.appendChild(root)

  let opened = false
  let unsubscribe: (() => void) | undefined
  const visibilityCallbacks: Array<(open: boolean) => void> = []

  /** 刷新六行数据（面板显示期间由统计心跳驱动） */
  function update(snapshot: ReturnType<P2PStatsEngine['snapshot']>): void {
    const p2pOn = controller.p2pEnabled
    fields.state.textContent = resolveStateText(art, controller)
    fields.download.textContent = p2pOn
      ? `${formatSpeed(snapshot.downloadSpeed)}（P2P ${formatSpeed(snapshot.p2pDownloadSpeed)}）`
      : formatSpeed(snapshot.downloadSpeed)
    fields.ratio.textContent = p2pOn ? formatPercent(snapshot.p2pDownloadRatio) : '—'
    fields.upload.textContent = formatSpeed(snapshot.uploadSpeed)
    fields.peers.textContent = `${snapshot.peers} / ${snapshot.peakPeers}`
    fields.total.textContent = `↓ ${formatBytes(snapshot.totalDownloadedBytes)} · ↑ ${formatBytes(snapshot.uploadedBytes)}`
  }

  function notifyVisibility(): void {
    for (const callback of visibilityCallbacks) callback(opened)
  }

  function openPanel(): void {
    if (opened) return
    opened = true
    art.template.$player.classList.add(SHOW_CLASS)
    // 与原生「统计信息」面板同位互斥：打开自身前先关闭原生面板
    art.info.show = false
    unsubscribe = ticker.subscribe(update)
    notifyVisibility()
  }

  function closePanel(): void {
    if (!opened) return
    opened = false
    art.template.$player.classList.remove(SHOW_CLASS)
    unsubscribe?.()
    unsubscribe = undefined
    notifyVisibility()
  }

  function onCloseClick(event: Event): void {
    event.stopPropagation()
    closePanel()
  }
  $close.addEventListener('click', onCloseClick)

  // 反向互斥：原生「统计信息」面板打开时关闭 P2P 面板。
  // 自身打开引发的 art.info.show = false 会派发 info(false)，此处仅响应 true，无递归
  const onNativeInfo = (open: boolean): void => {
    if (open) closePanel()
  }
  art.on('info', onNativeInfo)

  // 右键菜单入口：紧邻官方「统计信息」（index 40）与「版本」（50）之间
  art.contextmenu.add({
    name: CONTEXTMENU_NAME,
    index: 45,
    html: art.i18n.get(I18N_KEY_STATS),
    click: (contextmenu) => {
      contextmenu.show = false
      openPanel()
    },
  })

  return {
    open: openPanel,
    close: closePanel,
    isOpen: () => opened,
    onVisibilityChange(callback) {
      visibilityCallbacks.push(callback)
    },
    destroy() {
      closePanel()
      art.off('info', onNativeInfo)
      $close.removeEventListener('click', onCloseClick)
    },
  }
}
