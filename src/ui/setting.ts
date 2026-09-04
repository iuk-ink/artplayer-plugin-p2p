/**
 * 设置面板 P2P 配置组（setting 组件）
 *
 * 三项开关：
 * - P2P 加速：经 controller.setP2PEnabled 无损动态切换，返回值由
 *   ArtPlayer 在 await 完成后渲染开关态
 * - 仅上传模式：开关语义与上传开关互补（开启 = 关闭上传），仅信令广播
 * - P2P 统计：控制右上角数据徽章显隐；徽章隐藏时开关状态同步回退
 *
 * @module ui/setting
 */

import type Artplayer from 'artplayer'
import type { P2PController } from '../controller'
import type { P2PSettingItemsOptions } from '../types/options'
import { I18N_KEY_P2P_ENABLED, I18N_KEY_STATS, I18N_KEY_UPLOAD_ONLY } from '../constants'
import { log } from '../debug'
import type { StatsBadgeHandle } from './stats-badge'

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
 * 跳过挂载（属正常配置路径，静默处理；右上角徽章不受
 * 此门控影响，仍可经 badge 选项启用）。各开关按 items
 * 配置选择性挂载，全部被隐藏时不挂载任何项
 *
 * @param art - ArtPlayer 实例
 * @param controller - 生命周期控制器
 * @param badge - 右上角数据徽章控制接口（stats 关闭时传 null）
 * @param items - 单项显示配置（已由 resolveOptions 填充默认值）
 * @returns 是否实际挂载了至少一项
 */
export function mountP2PSettings(
  art: Artplayer,
  controller: P2PController,
  badge: StatsBadgeHandle | null,
  items: P2PSettingItemsOptions,
): boolean {
  if (!art.option.setting) {
    log('option.setting disabled, P2P setting items skipped (badge remains available)')
    return false
  }

  let mounted = 0

  if (items.p2pEnabled) {
    art.setting.add({
      name: 'artp2pSetting',
      html: art.i18n.get(I18N_KEY_P2P_ENABLED),
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
      html: art.i18n.get(I18N_KEY_UPLOAD_ONLY),
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

  if (badge && items.stats) {
    const badgeItem = {
      name: 'artp2pStatsSetting',
      html: art.i18n.get(I18N_KEY_STATS),
      icon: ICON_STATS,
      switch: badge.isVisible(),
      onSwitch(item: { switch?: boolean }) {
        const next = !item.switch
        if (next) {
          badge.show()
        } else {
          badge.hide()
        }
        return next
      },
    }
    art.setting.add(badgeItem)
    // 徽章显隐变化时同步开关渲染态（switch 访问器赋值即更新 DOM）
    badge.onVisibilityChange((visible) => {
      badgeItem.switch = visible
    })
    mounted += 1
  }
  return mounted > 0
}
