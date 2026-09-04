/**
 * UI 层样式表
 *
 * P2P 面板复用官方 .art-info 容器 class（art-info artp2p-info 双类），
 * 定位 / 背景 / 行结构 / 关闭按钮等样式全部命中官方嵌套选择器，
 * 与原生「统计信息」面板视觉同构。
 *
 * 显隐必须与官方 class 彻底解耦：官方存在状态联动规则
 * `.art-video-player.art-info-show .art-info { display: flex }`，
 * 它按 .art-info 类名匹配，会把本面板一并纳入原生面板的 show
 * 状态（表现为：打开原生「统计信息」时 P2P 面板跟着展开，且此后
 * 本面板无法关闭）。因此这里用 !important 双规则显式接管显隐：
 * 默认强制隐藏，仅在 $player 挂有 artp2p-stats-show 时显示，
 * 官方的 art-info-show 切换对本面板完全失效
 *
 * 右上角数据徽章（artp2p-badge）为插件私有元素，无官方 class
 * 冲突，显隐经 visibility + opacity + transform 过渡实现——
 * display 变更不参与 CSS 过渡插值，无法承载淡入淡出动画；
 * 状态点颜色由 data-state 属性选择器驱动，与开关状态同源判定
 *
 * @module ui/styles
 */

/** 幂等注入标记：style 元素的 data 属性 */
const STYLE_TAG = 'data-artp2p'

/**
 * P2P 面板与右上角徽章样式
 *
 * 面板展示由 $player 上的 artp2p-stats-show class 唯一驱动；
 * 基础规则的 !important 用于压过官方 .art-info-show 联动规则。
 * 徽章展示由 $player 上的 artp2p-badge-show class 唯一驱动，
 * 私有 class 无联动冲突，无需 !important
 */
const P2P_UI_CSS = `
.art-video-player .art-info.artp2p-info {
  display: none !important;
}

.art-video-player.artp2p-stats-show .art-info.artp2p-info {
  display: flex !important;
}

.art-video-player .artp2p-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  color: #FDFDFD;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.8);
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  backdrop-filter: blur(8px);
  pointer-events: none;
  visibility: hidden;
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s ease;
}

.art-video-player.artp2p-badge-show .artp2p-badge {
  visibility: visible;
  opacity: 1;
  transform: none;
}

.artp2p-badge-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #9AA0AE;
}

.artp2p-badge[data-state='running'] .artp2p-badge-dot {
  background: #2BE08C;
}

.artp2p-badge[data-state='upload-only'] .artp2p-badge-dot {
  background: #F5D547;
}
`

/**
 * 幂等注入 UI 样式到 document.head
 *
 * 多播放器实例共用一份样式：已存在 data-artp2p 标记的
 * style 元素时跳过注入
 */
export function injectStyles(): void {
  const doc = document
  if (doc.querySelector(`style[${STYLE_TAG}]`)) return
  const style = doc.createElement('style')
  style.setAttribute(STYLE_TAG, '')
  style.textContent = P2P_UI_CSS
  doc.head.appendChild(style)
}
