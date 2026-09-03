/**
 * 设置面板 P2P 配置组（setting 组件）
 *
 * 三项开关：
 * - P2P 加速：经 controller.setP2PEnabled 无损动态切换，返回值由
 *   ArtPlayer 在 await 完成后渲染开关态
 * - 仅上传模式：开关语义与上传开关互补（开启 = 关闭上传），仅信令广播
 * - P2P 统计：控制统计面板显隐；面板经 [x] 关闭时开关状态同步回退
 *
 * @module ui/setting
 */

import type Artplayer from 'artplayer'
import type { P2PController } from '../controller'
import type { P2PSettingItemsOptions } from '../types'
import type { StatsPanelHandle } from './stats-menu'

/**
 * 设置项图标（24×24 viewBox，fill 跟随面板文字色）
 *
 * 官方在未传 icon 时会统一填充 icons.config 齿轮图标，
 * 此处按 Material 线条风格提供语义化图标以区分各项
 */
const ICON_P2P_ENABLED
  = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66l.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"/></svg>'

const ICON_UPLOAD_ONLY
  = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>'

const ICON_STATS
  = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z"/></svg>'

/**
 * 挂载设置面板 P2P 配置组
 *
 * 宿主未开启 option.setting 时 Setting 容器不渲染，
 * 跳过挂载并提示（统计面板仍可经右键菜单打开）。
 * 各开关按 items 配置选择性挂载，全部被隐藏时不挂载任何项
 *
 * @param art - ArtPlayer 实例
 * @param controller - 生命周期控制器
 * @param panel - 统计面板控制接口（stats 关闭时传 null）
 * @param items - 单项显示配置（已由 resolveOptions 填充默认值）
 * @returns 是否实际挂载了至少一项
 */
export function mountP2PSettings(
  art: Artplayer,
  controller: P2PController,
  panel: StatsPanelHandle | null,
  items: P2PSettingItemsOptions,
): boolean {
  if (!art.option.setting) {
    console.info('[artplayer-plugin-p2p] option.setting 未开启，跳过 P2P 设置开关挂载')
    return false
  }

  let mounted = 0

  if (items.p2pEnabled) {
    art.setting.add({
      name: 'artp2pSetting',
      html: 'P2P 加速',
      tooltip: 'P2P 加速',
      icon: ICON_P2P_ENABLED,
      switch: controller.p2pEnabled,
      onSwitch(item) {
        const next = !item.switch
        controller.setP2PEnabled(next)
        return next
      },
    })
    mounted += 1
  }

  if (items.uploadOnly) {
    art.setting.add({
      name: 'artp2pUploadSetting',
      html: '仅上传模式',
      tooltip: '仅上传模式',
      icon: ICON_UPLOAD_ONLY,
      switch: !controller.uploadEnabled,
      onSwitch(item) {
        const next = !item.switch
        controller.setUploadEnabled(!next)
        return next
      },
    })
    mounted += 1
  }

  if (panel && items.stats) {
    const panelItem = {
      name: 'artp2pStatsSetting',
      html: 'P2P 统计',
      tooltip: 'P2P 统计',
      icon: ICON_STATS,
      switch: panel.isOpen(),
      onSwitch(item: { switch?: boolean }) {
        const next = !item.switch
        if (next) {
          panel.open()
        } else {
          panel.close()
        }
        return next
      },
    }
    art.setting.add(panelItem)
    // 面板经 [x] 关闭（或 open/close）时同步开关渲染态
    panel.onVisibilityChange((open) => {
      panelItem.switch = open
    })
    mounted += 1
  }
  return mounted > 0
}
