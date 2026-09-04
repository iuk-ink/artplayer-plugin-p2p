import { C as I18N_MESSAGES, E as STATS_POLLING_MS, S as I18N_KEY_UPLOAD_ONLY, T as SCENE_PRESETS, _ as I18N_KEY_PEERS_UNIT, a as StatsTicker, b as I18N_KEY_STATE_UPLOAD_ONLY, c as DEFAULT_FATAL_RETRY_MAX, d as I18N_KEY_P2P_ENABLED, f as I18N_KEY_PANEL_DOWNLOAD, g as I18N_KEY_PANEL_UPLOAD, h as I18N_KEY_PANEL_TOTAL, i as resolveOptions, l as DEFAULT_TYPE, m as I18N_KEY_PANEL_STATE, n as applyScenePreset, o as P2PStatsEngine, p as I18N_KEY_PANEL_RATIO, r as mergeCoreConfig, s as BANDWIDTH_WINDOW_MS, t as applyRuntimeToggle, u as I18N_KEY_FATAL_NOTICE, v as I18N_KEY_STATE_DISABLED, w as P2P_EVENT_BRIDGE_MAP, x as I18N_KEY_STATS, y as I18N_KEY_STATE_RUNNING } from "./config-X6eAP82h.mjs";
import Hls from "hls.js";
import { HlsJsP2PEngine } from "p2p-media-loader-hlsjs";
//#region src/bridge.ts
/**
* 将 P2P 引擎事件桥接为 ArtPlayer 自定义事件并驱动统计引擎
*
* 每个引擎事件以 p2p:* 前缀原样转发（参数透传，宿主按事件名消费）；
* 流量与 peer 连接事件同时喂给统计引擎。
* 同一事件（如 onPeerConnect）会被转发与统计分别订阅，
* 两个监听器互不干扰
*
* @param art - ArtPlayer 实例
* @param engine - HlsJsP2PEngine 引擎实例
* @param stats - 统计引擎
*/
function attachEventBridge(art, engine, stats) {
	const subscribe = engine.addEventListener.bind(engine);
	for (const [eventName, artEventName] of Object.entries(P2P_EVENT_BRIDGE_MAP)) subscribe(eventName, (...args) => {
		art.emit(artEventName, ...args);
	});
	engine.addEventListener("onChunkDownloaded", (bytesLength, downloadSource) => {
		stats.recordDownload(bytesLength, downloadSource);
	});
	engine.addEventListener("onChunkUploaded", (bytesLength) => {
		stats.recordUpload(bytesLength);
	});
	engine.addEventListener("onPeerConnect", () => {
		stats.recordPeerConnect();
	});
	engine.addEventListener("onPeerClose", () => {
		stats.recordPeerClose();
	});
}
//#endregion
//#region src/recovery.ts
/**
* fatal 分级恢复策略
*
* 挂载在单个 hls.js 实例的 ERROR 事件上，随实例销毁而失效；
* 软恢复计数为实例级（重建后的新实例从零计数）
*/
var FatalRecoveryPolicy = class {
	#retryCount = 0;
	#isMediaRecoveryAttempted = false;
	#options;
	/**
	* @param hls - 目标 hls.js 实例
	* @param hlsConstructor - hls.js 构造器（Events/ErrorTypes 枚举来源，
	*   避免本模块引入 hls.js 运行时值以保持可移植性）
	* @param options - 回调集合
	*/
	constructor(hls, hlsConstructor, options) {
		this.#options = options;
		hls.on(hlsConstructor.Events.ERROR, (_event, data) => {
			if (!data.fatal) return;
			this.#handleFatal(hls, hlsConstructor, data);
		});
	}
	/**
	* fatal 分级处理
	*
	* 网络级：重新拉起加载；媒体级：软恢复（连续失败时切换音频编解码）；
	* 其他：软恢复无效，交由上层重建。超限后停止一切动作，
	* 仅保留通知，由宿主决策后续（如提示用户或换源）
	*/
	#handleFatal(hls, hlsConstructor, data) {
		const { retryMax, onFatalError, onUnrecoverable } = this.#options;
		if (this.#retryCount >= retryMax) {
			onFatalError(data, this.#retryCount);
			return;
		}
		this.#retryCount += 1;
		onFatalError(data, this.#retryCount);
		const { ErrorTypes } = hlsConstructor;
		if (data.type === ErrorTypes.NETWORK_ERROR) hls.startLoad();
		else if (data.type === ErrorTypes.MEDIA_ERROR) {
			if (this.#isMediaRecoveryAttempted) hls.swapAudioCodec();
			hls.recoverMediaError();
			this.#isMediaRecoveryAttempted = true;
		} else onUnrecoverable(data, this.#retryCount);
	}
};
//#endregion
//#region src/engine.ts
/**
* injectMixin 结果缓存
*
* injectMixin 每次调用都会生成新的子类，重复调用既浪费内存
* 又会破坏 instanceof 判断的一致性，因此按构造器缓存
*/
const hlsWithP2PCache = /* @__PURE__ */ new WeakMap();
/**
* 获取（或创建并缓存）注入 P2P 能力后的 hls.js 构造器
*
* @param hlsConstructor - 宿主提供的 hls.js 构造器
* @returns HlsWithP2P 构造器
*/
function getHlsWithP2PClass(hlsConstructor) {
	let cached = hlsWithP2PCache.get(hlsConstructor);
	if (!cached) {
		cached = HlsJsP2PEngine.injectMixin(hlsConstructor);
		hlsWithP2PCache.set(hlsConstructor, cached);
	}
	return cached;
}
/**
* 创建携带 P2P 能力的 hls.js 播放实例
*
* core 配置经 applyRuntimeToggle 注入当前开关状态；
* 仅完成实例构造与 fatal 恢复挂载，loadSource / attachMedia
* 的调用时机由调用方决定
*
* @param options - 引擎选项（含透传配置与运行时开关状态）
* @param hlsConstructor - 宿主提供的 hls.js 构造器（peerDependency 实例）
* @param hooks - 引擎钩子集合
* @returns HlsWithP2P 播放实例
*/
function createHlsWithP2P(options, hlsConstructor, hooks) {
	const hls = new (getHlsWithP2PClass(hlsConstructor))({
		...options.hls,
		p2p: {
			core: applyRuntimeToggle(mergeCoreConfig(options), options.p2pEnabled, options.uploadEnabled),
			onHlsJsCreated(instance) {
				hooks.onEngineCreated(instance.p2pEngine);
			}
		}
	});
	new FatalRecoveryPolicy(hls, hlsConstructor, {
		retryMax: options.fatalRetryMax ?? 2,
		onFatalError: hooks.onFatalError,
		onUnrecoverable: hooks.onUnrecoverable
	});
	return hls;
}
//#endregion
//#region src/controller.ts
/**
* P2P 实例生命周期控制器
*
* 唯一持有播放实例与跨实例状态（最近 URL / 视频 / 重建计数 /
* P2P 与上传开关）的状态机；换源、fatal 重建、开关切换、销毁
* 全部收敛为显式方法。art.hls 槽位的写入与清空只发生在本模块内
*
* 开关语义：
* - P2P / 上传开关经 engine.applyDynamicConfig 无损切换，
*   不销毁实例、不中断播放
* - 实例创建（首装 / fatal 重建 / 换源 / 重连）时按当前开关状态
*   注入初始配置，保证重建后模式不丢失
* - activate 不接受模式参数：模式一律取控制器运行时状态，
*   避免 customType 重入路径（video:error 重连）重置用户的开关选择
*
* @module controller
*/
/** P2P 实例生命周期控制器 */
var P2PController = class {
	#art;
	#options;
	#stats;
	#createInstance;
	#state = "idle";
	#p2pEnabled;
	#uploadEnabled;
	/** 跨实例的 fatal 重建计数（外部显式激活时归零，防止无限重建循环） */
	#recreateCount = 0;
	#currentUrl;
	#currentVideo;
	#instance;
	/** 当前实例在 art 上的 destroy 监听（实例切换时注销，避免累积监听） */
	#destroyHandler;
	/**
	* @param art - ArtPlayer 实例
	* @param options - 解析后的插件选项（p2pEnabled / uploadEnabled 为初始开关状态）
	* @param stats - 统计引擎实例（由入口层创建并共享给句柄）
	* @param createInstance - 实例创建工厂（默认真实引擎；测试注入假体
	*   以验证状态机编排，真实引擎在 Node 下的构造依赖面与此目标无关）
	*/
	constructor(art, options, stats, createInstance = createHlsWithP2P) {
		this.#art = art;
		this.#options = options;
		this.#stats = stats;
		this.#p2pEnabled = options.p2pEnabled;
		this.#uploadEnabled = options.uploadEnabled;
		this.#createInstance = createInstance;
	}
	/** 当前控制器状态 */
	get state() {
		return this.#state;
	}
	/** 当前 P2P 开关状态 */
	get p2pEnabled() {
		return this.#p2pEnabled;
	}
	/** 当前上传开关状态 */
	get uploadEnabled() {
		return this.#uploadEnabled;
	}
	/** 当前播放实例（与 art.hls 槽位同步） */
	get hls() {
		return this.#instance;
	}
	/**
	* 外部显式激活（customType 回调：首次加载 / 换源 / 重连共用）
	*
	* 视为新的播放意图：统计与重建计数全部归零，
	* 以控制器当前开关状态创建实例（不接受模式参数）
	*
	* @param url - 播放地址
	* @param video - 视频元素
	*/
	activate(url, video) {
		if (this.#state === "destroyed") return;
		this.#stop();
		this.#stats.reset();
		this.#recreateCount = 0;
		this.#start(url, video);
	}
	/** 销毁当前播放实例（注销监听、清空 art.hls 槽位） */
	deactivate() {
		if (this.#state === "destroyed") return;
		this.#stop();
	}
	/** 销毁现有实例后按最近地址与当前开关模式重建 */
	reload() {
		if (this.#state === "destroyed" || this.#currentUrl === void 0) return;
		this.activate(this.#currentUrl, this.#currentVideo);
	}
	/**
	* P2P 运行时开关：经 applyDynamicConfig 无损切换
	*
	* 不销毁实例、不中断播放；关闭时 HybridLoader 被引擎销毁、
	* peer 连接全断，主动清零 peer 计数防止残留（迟到关闭事件
	* 由统计引擎的非负保护兜底）；字节统计冻结保留供模式对照
	*
	* @param enabled - 目标 P2P 状态
	*/
	setP2PEnabled(enabled) {
		if (this.#state === "destroyed" || enabled === this.#p2pEnabled) return;
		this.#p2pEnabled = enabled;
		const engine = this.#instance?.p2pEngine;
		if (engine) {
			engine.applyDynamicConfig({ core: { isP2PDisabled: !enabled } });
			if (!enabled) this.#stats.resetPeers();
		}
		this.#emitStateChange();
	}
	/**
	* 上行运行时开关：仅信令广播（引擎内部处理），完全无缝
	*
	* @param enabled - 目标上传状态
	*/
	setUploadEnabled(enabled) {
		if (this.#state === "destroyed" || enabled === this.#uploadEnabled) return;
		this.#uploadEnabled = enabled;
		this.#instance?.p2pEngine.applyDynamicConfig({ core: { isP2PUploadDisabled: !enabled } });
		this.#emitStateChange();
	}
	/** 播放器销毁：终止一切并进入 destroyed（幂等） */
	destroy() {
		if (this.#state === "destroyed") return;
		this.#stop();
		this.#state = "destroyed";
	}
	/**
	* 创建并绑定播放实例（内部路径，不重置任何状态）
	*
	* 构造 EngineOptions 时以控制器当前开关状态覆盖选项初始值：
	* fatal 重建 / 换源 / 重连的实例重建均经此路径，
	* 保证重建后 P2P 与上传模式与用户当前选择一致
	*
	* @param url - 播放地址
	* @param video - 视频元素
	*/
	#start(url, video) {
		const engineOptions = {
			core: this.#options.core,
			tracker: this.#options.tracker,
			hls: this.#options.hls,
			fatalRetryMax: this.#options.fatalRetryMax,
			p2pEnabled: this.#p2pEnabled,
			uploadEnabled: this.#uploadEnabled
		};
		const instance = this.#createInstance(engineOptions, Hls, {
			onEngineCreated: (engine) => {
				attachEventBridge(this.#art, engine, this.#stats);
			},
			onFatalError: (data, retryCount) => {
				this.#art.emit("p2p:fatalError", data, retryCount);
			},
			onUnrecoverable: (data, retryCount) => {
				this.#handleUnrecoverable(data, retryCount);
			}
		});
		instance.loadSource(url);
		instance.attachMedia(video);
		this.#art.hls = instance;
		this.#instance = instance;
		this.#currentUrl = url;
		this.#currentVideo = video;
		this.#state = "active";
		this.#destroyHandler = () => {
			this.#instance = void 0;
			this.#currentVideo = void 0;
			this.#state = "destroyed";
			instance.destroy();
		};
		this.#art.on("destroy", this.#destroyHandler);
	}
	/** 销毁当前实例并回到 idle（不改变开关模式与重建计数） */
	#stop() {
		if (this.#destroyHandler) {
			this.#art.off("destroy", this.#destroyHandler);
			this.#destroyHandler = void 0;
		}
		const instance = this.#instance;
		this.#instance = void 0;
		this.#art.hls = void 0;
		this.#state = "idle";
		this.#stats.resetPeers();
		if (instance) instance.destroy();
	}
	/** 开关状态变化后派发 p2p:stateChange，供宿主同步自定义 UI */
	#emitStateChange() {
		const details = {
			p2pEnabled: this.#p2pEnabled,
			uploadEnabled: this.#uploadEnabled
		};
		this.#art.emit("p2p:stateChange", details);
	}
	/**
	* 不可恢复 fatal 的有界重建
	*
	* 重建计数超限后停止动作，发出带原因的 fatalError
	* 事件交由宿主决策（提示用户 / 换源）；fatalNotice 开启时
	* 另经 notice 提示终端用户（文案经 i18n，仅此终态一次）
	*/
	#handleUnrecoverable(_data, _retryCount) {
		if (this.#recreateCount >= this.#options.fatalRetryMax) {
			this.#art.emit("p2p:fatalError", {
				reason: "recreate-limit-exceeded",
				recreateCount: this.#recreateCount
			}, this.#recreateCount);
			if (this.#options.fatalNotice) this.#art.notice.show = this.#art.i18n.get(I18N_KEY_FATAL_NOTICE);
			return;
		}
		this.#recreateCount += 1;
		const url = this.#currentUrl;
		const video = this.#currentVideo;
		if (url === void 0 || video === void 0) return;
		this.#stop();
		this.#stats.reset();
		this.#start(url, video);
	}
};
//#endregion
//#region src/debug.ts
/**
* 调试日志模块
*
* 开关状态独立持有：入口的 artplayerPluginP2P.DEBUG 静态属性经
* getter/setter 代理至本模块，UI 层直接导入 log 使用——避免
* 入口与 UI 层互引造成循环依赖
*
* @module debug
*/
let enabled = false;
/** 由入口静态属性 setter 代理调用 */
function setDebugEnabled(value) {
	enabled = value;
}
function isDebugEnabled() {
	return enabled;
}
/**
* 调试日志输出（默认静默，带统一前缀）
*
* 用于插件装配细节的按需诊断；错误级诊断（customType 冲突）
* 应使用 console.warn 并不受本开关控制
*
* @param args - 日志内容
*/
function log(...args) {
	if (enabled) console.info("[artplayer-plugin-p2p]", ...args);
}
//#endregion
//#region src/ui/styles.ts
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
const STYLE_TAG = "data-artp2p";
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
`;
/**
* 幂等注入 UI 样式到 document.head
*
* 多播放器实例共用一份样式：已存在 data-artp2p 标记的
* style 元素时跳过注入
*/
function injectStyles() {
	const doc = document;
	if (doc.querySelector(`style[${STYLE_TAG}]`)) return;
	const style = doc.createElement("style");
	style.setAttribute(STYLE_TAG, "");
	style.textContent = P2P_UI_CSS;
	doc.head.appendChild(style);
}
//#endregion
//#region src/ui/format.ts
/**
* UI 层数值格式化工具
*
* @module ui/format
*/
/**
* 格式化字节数为可读字符串
*
* @param bytes - 字节数
* @returns 如 "1.2 MB" 的可读文本
*/
function formatBytes(bytes) {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${Math.round(bytes)} B`;
}
/**
* 格式化速率为可读字符串
*
* @param bytesPerSecond - 速率 B/s
* @returns 如 "1.2 MB/s" 的可读文本
*/
function formatSpeed(bytesPerSecond) {
	return `${formatBytes(bytesPerSecond)}/s`;
}
/**
* 格式化 P2P 占比为百分比文本
*
* @param ratio - 占比 0..1
* @returns 如 "72%" 的文本
*/
function formatPercent(ratio) {
	return `${Math.round(ratio * 100)}%`;
}
//#endregion
//#region src/ui/stats-menu.ts
/** 右键菜单项挂载名 */
const CONTEXTMENU_NAME = "artp2pStats";
/** 显隐 class：挂在 $player 上，配合注入的显隐规则驱动面板展示 */
const SHOW_CLASS$1 = "artp2p-stats-show";
/**
* 构建面板结构：行标题在挂载时经 i18n 解析（与设置项同为创建时
* 解析一次，运行中换语言需重建播放器）；冒号不入键，模板统一拼接
*
* @param art - ArtPlayer 实例
* @returns 面板根节点 HTML
*/
function buildPanelHtml(art) {
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
`;
}
/**
* 依据开关状态解析面板状态行文本
*
* @param art - ArtPlayer 实例（状态文案经 i18n 解析）
* @param controller - 生命周期控制器（读取 P2P / 上传开关）
* @returns 运行中 / 仅上传 / 已关闭（按宿主语言）
*/
function resolveStateText(art, controller) {
	if (!controller.p2pEnabled) return art.i18n.get(I18N_KEY_STATE_DISABLED);
	if (!controller.uploadEnabled) return art.i18n.get(I18N_KEY_STATE_UPLOAD_ONLY);
	return art.i18n.get(I18N_KEY_STATE_RUNNING);
}
/**
* 挂载右键菜单「P2P 统计」项与独立 P2P 面板
*
* @param art - ArtPlayer 实例
* @param controller - 生命周期控制器（读取开关状态）
* @param ticker - 统计心跳（面板显示期间订阅，数据由心跳推送）
* @returns 面板控制接口
*/
function mountStatsMenu(art, controller, ticker) {
	const wrapper = document.createElement("div");
	wrapper.innerHTML = buildPanelHtml(art);
	const root = wrapper.firstElementChild;
	const fields = {
		state: root.querySelector("[data-field=\"state\"]"),
		download: root.querySelector("[data-field=\"download\"]"),
		ratio: root.querySelector("[data-field=\"ratio\"]"),
		upload: root.querySelector("[data-field=\"upload\"]"),
		peers: root.querySelector("[data-field=\"peers\"]"),
		total: root.querySelector("[data-field=\"total\"]")
	};
	const $close = root.querySelector(".art-info-close");
	art.template.$player.appendChild(root);
	let opened = false;
	let unsubscribe;
	const visibilityCallbacks = [];
	/** 刷新六行数据（面板显示期间由统计心跳驱动） */
	function update(snapshot) {
		const p2pOn = controller.p2pEnabled;
		fields.state.textContent = resolveStateText(art, controller);
		fields.download.textContent = p2pOn ? `${formatSpeed(snapshot.downloadSpeed)}（P2P ${formatSpeed(snapshot.p2pDownloadSpeed)}）` : formatSpeed(snapshot.downloadSpeed);
		fields.ratio.textContent = p2pOn ? formatPercent(snapshot.p2pDownloadRatio) : "—";
		fields.upload.textContent = formatSpeed(snapshot.uploadSpeed);
		fields.peers.textContent = `${snapshot.peers} / ${snapshot.peakPeers}`;
		fields.total.textContent = `↓ ${formatBytes(snapshot.totalDownloadedBytes)} · ↑ ${formatBytes(snapshot.uploadedBytes)}`;
	}
	function notifyVisibility() {
		for (const callback of visibilityCallbacks) callback(opened);
	}
	function openPanel() {
		if (opened) return;
		opened = true;
		art.template.$player.classList.add(SHOW_CLASS$1);
		art.info.show = false;
		unsubscribe = ticker.subscribe(update);
		notifyVisibility();
	}
	function closePanel() {
		if (!opened) return;
		opened = false;
		art.template.$player.classList.remove(SHOW_CLASS$1);
		unsubscribe?.();
		unsubscribe = void 0;
		notifyVisibility();
	}
	function onCloseClick(event) {
		event.stopPropagation();
		closePanel();
	}
	$close.addEventListener("click", onCloseClick);
	const onNativeInfo = (open) => {
		if (open) closePanel();
	};
	art.on("info", onNativeInfo);
	art.contextmenu.add({
		name: CONTEXTMENU_NAME,
		index: 45,
		html: art.i18n.get(I18N_KEY_STATS),
		click: (contextmenu) => {
			contextmenu.show = false;
			openPanel();
		}
	});
	return {
		open: openPanel,
		close: closePanel,
		isOpen: () => opened,
		onVisibilityChange(callback) {
			visibilityCallbacks.push(callback);
		},
		destroy() {
			closePanel();
			art.off("info", onNativeInfo);
			$close.removeEventListener("click", onCloseClick);
		}
	};
}
//#endregion
//#region src/ui/stats-badge.ts
/** 显隐 class：挂在 $player 上，配合注入的显隐规则驱动徽章展示 */
const SHOW_CLASS = "artp2p-badge-show";
/** 展开态 class：挂在徽章根上，驱动详情区的 grid 高度过渡 */
const EXPANDED_CLASS = "artp2p-badge-expanded";
/**
* 徽章结构模板：速览行（状态点 + 数据文本）+ 可展开详情区
*
* 详情区为 grid 行轨道容器（0fr ↔ 1fr 过渡驱动高度动画），
* 内层 overflow hidden 承载三行详情；行 label 为静态文案：
* 占比 / 累计流量在挂载时经 i18n 解析一次（与设置项 / 面板
* 标题同时机），Peers 为通用术语不设键、字面量直书，与右键
* 面板的同位标题保持一致；数值单元格由统计心跳刷新
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
`;
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
function mountStatsBadge(art, controller, ticker) {
	const wrapper = document.createElement("div");
	wrapper.innerHTML = BADGE_HTML;
	const root = wrapper.firstElementChild;
	const text = root.querySelector("[data-field=\"text\"]");
	const detailFields = {
		peers: root.querySelector("[data-field=\"detail-peers\"]"),
		ratio: root.querySelector("[data-field=\"detail-ratio\"]"),
		total: root.querySelector("[data-field=\"detail-total\"]")
	};
	root.querySelector("[data-field=\"detail-ratio-label\"]").textContent = art.i18n.get(I18N_KEY_PANEL_RATIO);
	root.querySelector("[data-field=\"detail-total-label\"]").textContent = art.i18n.get(I18N_KEY_PANEL_TOTAL);
	art.template.$player.appendChild(root);
	let visible = false;
	let expanded = false;
	let unsubscribe;
	const visibilityCallbacks = [];
	/** 切换展开态：class 驱动 CSS grid 高度过渡，aria 同步供辅助技术感知 */
	function toggleExpanded() {
		expanded = !expanded;
		root.classList.toggle(EXPANDED_CLASS, expanded);
		root.setAttribute("aria-expanded", String(expanded));
	}
	/** 收起展开态（隐藏徽章时调用：隐藏期间心跳停更，展开态会陈旧） */
	function collapse() {
		if (expanded) toggleExpanded();
	}
	/**
	* 刷新速览行与详情区数值（显示期间由统计心跳驱动）
	*
	* P2P 关闭时上行与节点数恒为零，速览仅保留下行速率、
	* 占比置为占位符，避免零值噪音；仅上传模式下上行 0
	* 属真实状态，保留展示
	*/
	function update(snapshot) {
		const p2pOn = controller.p2pEnabled;
		root.dataset.state = !p2pOn ? "off" : controller.uploadEnabled ? "running" : "upload-only";
		text.textContent = p2pOn ? `↓ ${formatSpeed(snapshot.downloadSpeed)} · ↑ ${formatSpeed(snapshot.uploadSpeed)} · ${snapshot.peers} ${art.i18n.get(I18N_KEY_PEERS_UNIT)}` : `↓ ${formatSpeed(snapshot.downloadSpeed)}`;
		detailFields.peers.textContent = `${snapshot.peers} / ${snapshot.peakPeers}`;
		detailFields.ratio.textContent = p2pOn ? formatPercent(snapshot.p2pDownloadRatio) : "—";
		detailFields.total.textContent = `↓ ${formatBytes(snapshot.totalDownloadedBytes)} · ↑ ${formatBytes(snapshot.uploadedBytes)}`;
	}
	function notifyVisibility() {
		for (const callback of visibilityCallbacks) callback(visible);
	}
	function showBadge() {
		if (visible) return;
		visible = true;
		art.template.$player.classList.add(SHOW_CLASS);
		unsubscribe = ticker.subscribe(update);
		notifyVisibility();
	}
	function hideBadge() {
		if (!visible) return;
		visible = false;
		collapse();
		art.template.$player.classList.remove(SHOW_CLASS);
		unsubscribe?.();
		unsubscribe = void 0;
		notifyVisibility();
	}
	const onBadgeClick = (event) => {
		event.stopPropagation();
		toggleExpanded();
	};
	const onBadgeKeyDown = (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		event.stopPropagation();
		toggleExpanded();
	};
	root.addEventListener("click", onBadgeClick);
	root.addEventListener("keydown", onBadgeKeyDown);
	return {
		show: showBadge,
		hide: hideBadge,
		isVisible: () => visible,
		onVisibilityChange(callback) {
			visibilityCallbacks.push(callback);
		},
		destroy() {
			hideBadge();
			root.removeEventListener("click", onBadgeClick);
			root.removeEventListener("keydown", onBadgeKeyDown);
		}
	};
}
//#endregion
//#region src/ui/setting.ts
/**
* 设置项图标（24×24 viewBox，fill 跟随面板文字色）
*
* 官方在未传 icon 时会统一填充 icons.config 齿轮图标，
* 此处按 Material 线条风格提供语义化图标以区分各项
*/
const ICON_P2P_ENABLED = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66l.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z\"/></svg>";
const ICON_UPLOAD_ONLY = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z\"/></svg>";
const ICON_STATS = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z\"/></svg>";
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
function mountP2PSettings(art, controller, badge, items) {
	if (!art.option.setting) {
		log("option.setting disabled, P2P setting items skipped (badge remains available)");
		return false;
	}
	let mounted = 0;
	if (items.p2pEnabled) {
		art.setting.add({
			name: "artp2pSetting",
			html: art.i18n.get(I18N_KEY_P2P_ENABLED),
			icon: ICON_P2P_ENABLED,
			switch: controller.p2pEnabled,
			onSwitch(item) {
				const next = !item.switch;
				controller.setP2PEnabled(next);
				return next;
			}
		});
		mounted += 1;
	}
	if (items.uploadOnly) {
		art.setting.add({
			name: "artp2pUploadSetting",
			html: art.i18n.get(I18N_KEY_UPLOAD_ONLY),
			icon: ICON_UPLOAD_ONLY,
			switch: !controller.uploadEnabled,
			onSwitch(item) {
				const next = !item.switch;
				controller.setUploadEnabled(!next);
				return next;
			}
		});
		mounted += 1;
	}
	if (badge && items.stats) {
		const badgeItem = {
			name: "artp2pStatsSetting",
			html: art.i18n.get(I18N_KEY_STATS),
			icon: ICON_STATS,
			switch: badge.isVisible(),
			onSwitch(item) {
				const next = !item.switch;
				if (next) badge.show();
				else badge.hide();
				return next;
			}
		};
		art.setting.add(badgeItem);
		badge.onVisibilityChange((visible) => {
			badgeItem.switch = visible;
		});
		mounted += 1;
	}
	return mounted > 0;
}
//#endregion
//#region src/ui/index.ts
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
function mountUI(art, controller, ticker, options) {
	if (!options.uiEnabled) {
		log("ui skipped (ui: false)");
		return null;
	}
	injectStyles();
	let panel = null;
	let badge = null;
	if (options.statsEnabled) {
		panel = mountStatsMenu(art, controller, ticker);
		log("stats panel mounted (contextmenu entry included)");
		badge = mountStatsBadge(art, controller, ticker);
		if (options.badgeEnabled) {
			badge.show();
			log("badge initially visible (badge: true)");
		} else log("badge mounted hidden");
	} else log("stats UI skipped (stats: false)");
	if (options.settingEnabled) log(mountP2PSettings(art, controller, badge, options.settingItems) ? "setting items mounted" : "setting items all hidden");
	else log("setting group skipped (ui.setting false)");
	art.on("destroy", () => {
		panel?.destroy();
		badge?.destroy();
	});
	return badge;
}
//#endregion
//#region src/index.ts
/**
* ArtPlayer P2P 插件入口
*
* 将 p2p-media-loader（hls.js 引擎）封装为 ArtPlayer 插件：
* 通过 option.plugins 注入即可为 m3u8 播放启用 P2P 分发，
* 支持自建 tracker 信令服务器配置、运行时开关与统计
*
* 组装流程依赖 ArtPlayer 的两个时序事实：
* 1. 插件工厂在 Player.optionInit 之后执行，首次 URL 加载已经发生，
*    因此 customType 注册完成后需要对匹配类型的源做二次赋值补救
* 2. video:error 重连经 art.url 重赋值会重新进入 customType 回调，
*    回调内控制器的 activate 幂等（先销毁再重建），重入安全
*
* 用法：
*   new Artplayer({
*     url: 'https://example.com/stream.m3u8',
*     type: 'm3u8',
*     plugins: [artplayerPluginP2P({ tracker: { announceTrackers: ['wss://tracker.example.com'] } })],
*   })
*
* @module index
*/
/**
* 从 URL 提取小写扩展名（不含点）
*
* 依次剥离 hash 与 query 后取最后一个点之后的部分，整体小写化。
* 与 ArtPlayer 内部 getExt 的差异仅在"无扩展名"场景：官方会返回
* 去协议后的整条路径，本实现返回空串——两种结果均不会命中
* customType（宿主该场景必须显式传 option.type），判定殊途同归
*
* @param url - 原始 URL
* @returns 扩展名，无扩展名时返回空字符串
*/
function getUrlExtension(url) {
	const withoutQuery = url.split("#")[0].split("?")[0];
	const lastDotIndex = withoutQuery.lastIndexOf(".");
	if (lastDotIndex === -1) return "";
	return withoutQuery.slice(lastDotIndex + 1).toLowerCase();
}
/**
* 插件工厂实现：组装 customType 注册、首载时序补救与句柄
* （DEBUG / version 静态成员经 P2PPluginFactory 类型断言挂载，
* 见模块尾部的赋值与代理逻辑）
*
* @param options - 插件选项
* @returns ArtPlayer 插件函数
*/
function artplayerPluginP2PImpl(options = {}) {
	return (art) => {
		const resolved = resolveOptions(options);
		const stats = new P2PStatsEngine();
		const controller = new P2PController(art, resolved, stats);
		const ticker = new StatsTicker(stats, STATS_POLLING_MS);
		art.i18n.update(I18N_MESSAGES);
		log("i18n messages registered");
		const badge = mountUI(art, controller, ticker, resolved);
		const unsubscribeStatsTickEvent = ticker.subscribe((snapshot) => {
			art.emit("p2p:statsTick", snapshot);
		});
		art.on("destroy", () => {
			unsubscribeStatsTickEvent();
			ticker.destroy();
		});
		/**
		* customType 回调：URL 设置时由 ArtPlayer 调用
		*
		* 覆盖首次加载、换源与重连全部场景（均收敛为
		* controller.activate，模式取控制器运行时状态）；
		* MSE 不可用时降级为原生 HLS 或 notice 提示
		*/
		function typeCallback(video, url) {
			if (!Hls.isSupported()) {
				if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = url;
				else art.notice.show = `Unsupported playback format: ${resolved.typeName}`;
				return;
			}
			controller.activate(url, video);
		}
		let registered = false;
		const customTypeMap = art.option.customType ?? (art.option.customType = {});
		if (customTypeMap[resolved.typeName]) console.warn(`[artplayer-plugin-p2p] customType "${resolved.typeName}" already exists, P2P takeover skipped; pass a different "type" or remove the existing registration`);
		else {
			customTypeMap[resolved.typeName] = typeCallback;
			registered = true;
			log(`customType "${resolved.typeName}" registered`);
		}
		if (registered) {
			const optionUrl = art.option.url;
			if (optionUrl) {
				if ((art.option.type || getUrlExtension(optionUrl)) === resolved.typeName) {
					const { $video } = art.template;
					const rawSrc = $video.getAttribute("src");
					if (rawSrc && !rawSrc.startsWith("blob:")) {
						$video.removeAttribute("src");
						$video.load();
					}
					art.url = optionUrl;
					log("first-load remedy applied: reassigned art.url to trigger P2P takeover");
				}
			}
		}
		return {
			name: "artplayerPluginP2P",
			get engine() {
				return controller.hls?.p2pEngine;
			},
			get hls() {
				return controller.hls;
			},
			destroy() {
				controller.destroy();
			},
			reload() {
				controller.reload();
			},
			getStats() {
				return stats.snapshot();
			},
			setP2PEnabled(enabled) {
				controller.setP2PEnabled(enabled);
			},
			isP2PEnabled() {
				return controller.p2pEnabled;
			},
			setUploadEnabled(enabled) {
				controller.setUploadEnabled(enabled);
			},
			isUploadEnabled() {
				return controller.uploadEnabled;
			},
			setBadgeVisible(visible) {
				if (visible) badge?.show();
				else badge?.hide();
			},
			isBadgeVisible() {
				return badge?.isVisible() ?? false;
			},
			onStatsTick(callback) {
				return ticker.subscribe(callback);
			},
			/**
			* 运行时动态配置透传：转发到当前引擎的 Core.applyDynamicConfig；
			* 无活跃实例时不生效（即时调参语义，不做延迟补发）
			*/
			applyDynamicConfig(patch) {
				controller.hls?.p2pEngine.applyDynamicConfig({ core: patch });
			}
		};
	};
}
/**
* 插件工厂（default 导出）：携带 DEBUG / version 静态成员
*/
const artplayerPluginP2P = artplayerPluginP2PImpl;
artplayerPluginP2P.version = "1.0.0";
Object.defineProperty(artplayerPluginP2P, "DEBUG", {
	enumerable: true,
	get: () => isDebugEnabled(),
	set: (value) => setDebugEnabled(Boolean(value))
});
//#endregion
export { BANDWIDTH_WINDOW_MS, DEFAULT_FATAL_RETRY_MAX, DEFAULT_TYPE, FatalRecoveryPolicy, P2PController, P2PStatsEngine, P2P_EVENT_BRIDGE_MAP, SCENE_PRESETS, STATS_POLLING_MS, StatsTicker, applyRuntimeToggle, applyScenePreset, createHlsWithP2P, artplayerPluginP2P as default, mergeCoreConfig, resolveOptions };
