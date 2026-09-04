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
 * 状态点颜色由 data-state 属性选择器驱动，与开关状态同源判定。
 * 点击展开的详情区高度动画采用 grid 行轨道（0fr ↔ 1fr）过渡：
 * 浏览器对内容自然高度插值，无预设 max-height 魔法数字，也无需
 * JS 测量；内层 overflow hidden 使 grid item 的自动最小尺寸归零，
 * 是轨道过渡成立的前提。展开态圆角 / 内边距随行轨道同步过渡，
 * prefers-reduced-motion 下全部动效压至瞬时应答。
 * 徽章经媒体查询做多端自适应：窄视口或矮视口（手机竖横屏）
 * 下收缩字号与内边距并贴边，减少对视频画面的遮挡
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
  flex-direction: column;
  align-items: stretch;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  color: #FDFDFD;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.8);
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.12);
  /* 圆角用固定 13px（约等于收起态高度的一半）而非 999px 胶囊魔法值：
   * 999px 渲染时被钳制为半高，展开过渡的前半段插值仍远大于高度、
   * 圆角跟随高度增长变化，后半段才进入真实插值，产生「很圆 →
   * 突变正常」的不自然形变；固定值与胶囊渲染结果一致（超出半高
   * 部分自动钳制，窄视口下同样收敛为半高），过渡全程圆角近似恒定，
   * 轮廓由高度动画自然从胶囊稀释为卡片 */
  border-radius: 13px;
  backdrop-filter: blur(8px);
  pointer-events: auto;
  cursor: pointer;
  visibility: hidden;
  opacity: 0;
  transform: translateY(-6px);
  transition:
    opacity 0.2s ease,
    transform 0.2s ease,
    visibility 0.2s ease,
    background-color 0.2s ease,
    border-radius 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    padding 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.art-video-player.artp2p-badge-show .artp2p-badge {
  visibility: visible;
  opacity: 1;
  transform: none;
}

.art-video-player .artp2p-badge:hover {
  background-color: rgba(0, 0, 0, 0.6);
}

.art-video-player .artp2p-badge:focus-visible {
  outline: none;
  background-color: rgba(0, 0, 0, 0.65);
  border-color: rgba(255, 255, 255, 0.4);
}

.art-video-player .artp2p-badge-summary {
  display: flex;
  align-items: center;
  gap: 5px;
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

.art-video-player .artp2p-badge-details {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.art-video-player .artp2p-badge-details-inner {
  overflow: hidden;
}

.art-video-player .artp2p-badge-detail-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 4px;
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transform: translateY(-4px);
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.art-video-player .artp2p-badge-expanded {
  border-radius: 14px;
  padding: 6px 12px;
}

.art-video-player .artp2p-badge-expanded .artp2p-badge-details {
  grid-template-rows: 1fr;
}

.art-video-player .artp2p-badge-expanded .artp2p-badge-detail-row {
  opacity: 1;
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .art-video-player .artp2p-badge,
  .art-video-player .artp2p-badge-details,
  .art-video-player .artp2p-badge-detail-row {
    transition-duration: 0.01s;
  }
}

/* 多端自适应：窄视口（手机竖屏）或矮视口（手机横屏，宽度可能超过 768px）
 * 时收缩徽章尺寸并贴边，降低对视频画面的遮挡；桌面与全屏不受影响 */
@media (max-width: 768px), (max-height: 500px) {
  .art-video-player .artp2p-badge {
    top: 6px;
    right: 6px;
    padding: 2px 8px;
    font-size: 10px;
  }

  .art-video-player .artp2p-badge-summary {
    gap: 4px;
  }

  .art-video-player .artp2p-badge-dot {
    width: 5px;
    height: 5px;
  }

  .art-video-player .artp2p-badge-detail-row {
    gap: 8px;
    padding-top: 3px;
  }

  .art-video-player .artp2p-badge-expanded {
    padding: 4px 10px;
  }
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
