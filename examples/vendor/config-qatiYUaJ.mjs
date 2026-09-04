//#region src/bandwidth.ts
/**
* 滑动时间窗带宽计算器
*
* 每笔字节记录为独立样本，读取速率时惰性清理窗口外样本；
* 样本量与窗口内的 chunk 频次成正比（直播场景上限约数百个），无需主动压缩
*/
var BandwidthCalculator = class {
	#windowMs;
	#samples = [];
	/**
	* @param windowMs - 滑动时间窗长度（毫秒），窗口越长速率越平滑
	*/
	constructor(windowMs) {
		this.#windowMs = windowMs;
	}
	/**
	* 记录一笔字节
	*
	* @param bytes - 字节数（非正值直接忽略，防御脏数据）
	* @param timestampMs - 样本时间戳；缺省取 performance.now()，测试可注入固定时间
	*/
	record(bytes, timestampMs = performance.now()) {
		if (bytes <= 0) return;
		this.#samples.push({
			timestampMs,
			bytes
		});
	}
	/**
	* 计算窗口内平均速率
	*
	* 读取时惰性清理过期样本；速率按整个窗口长度折算而非
	* 首尾样本间隔，保证窗口未填满时（刚启动）读数平滑趋近真实值
	*
	* @param nowMs - 当前时间戳；缺省取 performance.now()，测试可注入固定时间
	* @returns 速率 B/s
	*/
	getSpeed(nowMs = performance.now()) {
		this.#removeExpired(nowMs);
		let totalBytes = 0;
		for (const sample of this.#samples) totalBytes += sample.bytes;
		return totalBytes / (this.#windowMs / 1e3);
	}
	/** 清空全部样本 */
	reset() {
		this.#samples.length = 0;
	}
	/**
	* 移除窗口外的过期样本
	*
	* 样本时间戳单调递增（缺省时间源 performance.now 单调；
	* 注入时间戳同样须单调），从头扫描至首个窗口内样本即可。
	* 边界样本（age 恰等于窗口长）保留在窗口内，与 p2pml
	* 官方带宽计算的过期判定语义保持一致
	*/
	#removeExpired(nowMs) {
		const cutoff = nowMs - this.#windowMs;
		let firstValid = this.#samples.length;
		for (let i = 0; i < this.#samples.length; i++) if (this.#samples[i].timestampMs >= cutoff) {
			firstValid = i;
			break;
		}
		this.#samples.splice(0, firstValid);
	}
};
//#endregion
//#region src/constants.ts
/** customType 注册的默认格式名 */
const DEFAULT_TYPE = "m3u8";
/** fatal 错误销毁重建的默认最大次数 */
const DEFAULT_FATAL_RETRY_MAX = 2;
/**
* 插件 UI 文案的 i18n 键（中文原文即键）
*
* ArtPlayer 的 i18n.get 未命中时回退键本身，
* 因此中文站点零配置即显示原文；其他语言经语言包注册生效
*/
const I18N_KEY_P2P_ENABLED = "P2P 加速";
const I18N_KEY_UPLOAD_ONLY = "仅上传模式";
const I18N_KEY_STATS = "P2P 统计";
const I18N_KEY_FATAL_NOTICE = "P2P 加速恢复失败，已转为直连播放";
/** 右键统计面板的行标题（Peers 为通用术语不设键） */
const I18N_KEY_PANEL_STATE = "P2P 状态";
const I18N_KEY_PANEL_DOWNLOAD = "下行速率";
const I18N_KEY_PANEL_RATIO = "P2P 占比";
const I18N_KEY_PANEL_UPLOAD = "上行速率";
const I18N_KEY_PANEL_TOTAL = "累计流量";
/** 右键统计面板状态行（「仅上传」与设置项「仅上传模式」是不同文案，独立键） */
const I18N_KEY_STATE_RUNNING = "运行中";
const I18N_KEY_STATE_UPLOAD_ONLY = "仅上传";
const I18N_KEY_STATE_DISABLED = "已关闭";
/** 右上角徽章的节点数单位 */
const I18N_KEY_PEERS_UNIT = "节点";
/**
* 插件自带语言包（经 art.i18n.update 深合并注册）
*
* 中文无需注册（键即原文）；宿主 option.lang 匹配注册语言时
* 自动显示译文；宿主可在播放器创建后再次 update 覆写插件文案
*/
const I18N_MESSAGES = { en: {
	[I18N_KEY_P2P_ENABLED]: "P2P Acceleration",
	[I18N_KEY_UPLOAD_ONLY]: "Upload Only",
	[I18N_KEY_STATS]: "P2P Stats",
	[I18N_KEY_FATAL_NOTICE]: "P2P recovery failed, switched to direct playback",
	[I18N_KEY_PANEL_STATE]: "P2P State",
	[I18N_KEY_PANEL_DOWNLOAD]: "Download",
	[I18N_KEY_PANEL_RATIO]: "P2P Ratio",
	[I18N_KEY_PANEL_UPLOAD]: "Upload",
	[I18N_KEY_PANEL_TOTAL]: "Total Traffic",
	[I18N_KEY_STATE_RUNNING]: "Running",
	[I18N_KEY_STATE_UPLOAD_ONLY]: "Upload Only",
	[I18N_KEY_STATE_DISABLED]: "Disabled",
	[I18N_KEY_PEERS_UNIT]: "peers"
} };
/**
* 统计带宽计算的滑动时间窗长度（毫秒）
*
* 直播切片通常 2-6s，10 秒窗口可平滑速率抖动
*/
const BANDWIDTH_WINDOW_MS = 1e4;
/** 统计心跳周期（毫秒），与 ArtPlayer 的 INFO_LOOP_TIME 对齐 */
const STATS_POLLING_MS = 1e3;
/**
* Core 事件到 ArtPlayer 自定义事件的映射表
*
* 键集合与 p2p-media-loader 的 CoreEventMap 完全一致，
* 通过 satisfies 做编译期穷尽性检查：Core 新增事件或本表遗漏/多余键时
* 构建直接失败，保证事件桥不丢失任何事件
*/
const P2P_EVENT_BRIDGE_MAP = {
	onStreamAdded: "p2p:streamAdded",
	onStreamRegistrationError: "p2p:streamRegistrationError",
	onSegmentLoaded: "p2p:segmentLoaded",
	onSegmentError: "p2p:segmentError",
	onSegmentAbort: "p2p:segmentAbort",
	onSegmentStart: "p2p:segmentStart",
	onPeerConnect: "p2p:peerConnect",
	onPeerConnectError: "p2p:peerConnectError",
	onPeerClose: "p2p:peerClose",
	onPeerError: "p2p:peerError",
	onPeerWarning: "p2p:peerWarning",
	onChunkDownloaded: "p2p:chunkDownloaded",
	onChunkUploaded: "p2p:chunkUploaded",
	onTrackerError: "p2p:trackerError",
	onTrackerWarning: "p2p:trackerWarning"
};
//#endregion
//#region src/stats.ts
/**
* P2P 统计引擎
*
* 累加器 + 三个带宽通道（P2P 下行 / HTTP 下行 / 上行）+ 派生指标；
* 由事件桥喂点，对外提供快照读取与重置。
* 纯逻辑实现：不触碰任何播放器与引擎状态，Node 可直接单测
*
* @module stats
*/
/** P2P 统计引擎 */
var P2PStatsEngine = class {
	#peers = 0;
	#peakPeers = 0;
	#p2pDownloadedBytes = 0;
	#httpDownloadedBytes = 0;
	#uploadedBytes = 0;
	#downloadBandwidths = {
		p2p: new BandwidthCalculator(BANDWIDTH_WINDOW_MS),
		http: new BandwidthCalculator(BANDWIDTH_WINDOW_MS)
	};
	#uploadBandwidth = new BandwidthCalculator(BANDWIDTH_WINDOW_MS);
	/** 记录一个 peer 连接建立（同时维护峰值） */
	recordPeerConnect() {
		this.#peers += 1;
		if (this.#peers > this.#peakPeers) this.#peakPeers = this.#peers;
	}
	/** 记录一个 peer 连接断开（计数不小于零） */
	recordPeerClose() {
		if (this.#peers > 0) this.#peers -= 1;
	}
	/**
	* 记录一笔下行字节
	*
	* @param bytes - 字节数
	* @param channel - 下载通道（http / p2p）
	* @param timestampMs - 样本时间戳；缺省取 performance.now()，测试可注入固定时间
	*/
	recordDownload(bytes, channel, timestampMs) {
		if (bytes <= 0) return;
		if (channel === "p2p") this.#p2pDownloadedBytes += bytes;
		else this.#httpDownloadedBytes += bytes;
		this.#downloadBandwidths[channel].record(bytes, timestampMs);
	}
	/**
	* 记录一笔 P2P 上行字节
	*
	* @param bytes - 字节数
	* @param timestampMs - 样本时间戳；缺省取 performance.now()，测试可注入固定时间
	*/
	recordUpload(bytes, timestampMs) {
		if (bytes <= 0) return;
		this.#uploadedBytes += bytes;
		this.#uploadBandwidth.record(bytes, timestampMs);
	}
	/**
	* 输出当前统计快照（累计量 + 派生指标一次算清）
	*
	* 带宽基准时间只取一次、每通道只计算一次，
	* 保证快照内部指标自洽（downloadSpeed 恒等于两通道之和）
	*
	* @param nowMs - 带宽计算基准时间戳；缺省取 performance.now()，测试可注入固定时间
	*/
	snapshot(nowMs) {
		const totalDownloadedBytes = this.#p2pDownloadedBytes + this.#httpDownloadedBytes;
		const now = nowMs ?? performance.now();
		const p2pDownloadSpeed = this.#downloadBandwidths.p2p.getSpeed(now);
		const httpDownloadSpeed = this.#downloadBandwidths.http.getSpeed(now);
		return {
			peers: this.#peers,
			peakPeers: this.#peakPeers,
			p2pDownloadedBytes: this.#p2pDownloadedBytes,
			httpDownloadedBytes: this.#httpDownloadedBytes,
			uploadedBytes: this.#uploadedBytes,
			totalDownloadedBytes,
			p2pDownloadRatio: totalDownloadedBytes > 0 ? this.#p2pDownloadedBytes / totalDownloadedBytes : 0,
			downloadSpeed: p2pDownloadSpeed + httpDownloadSpeed,
			p2pDownloadSpeed,
			uploadSpeed: this.#uploadBandwidth.getSpeed(now)
		};
	}
	/**
	* 清零当前 peer 计数
	*
	* 动态关闭 P2P 或销毁播放实例后连接已全部断开（引擎销毁不保证
	* 逐个发出 onPeerClose），主动清零防止残留计数污染下一次快照；
	* 峰值与字节累计保留
	*/
	resetPeers() {
		this.#peers = 0;
	}
	/** 重置全部计数与样本（换源时调用） */
	reset() {
		this.#peers = 0;
		this.#peakPeers = 0;
		this.#p2pDownloadedBytes = 0;
		this.#httpDownloadedBytes = 0;
		this.#uploadedBytes = 0;
		this.#downloadBandwidths.p2p.reset();
		this.#downloadBandwidths.http.reset();
		this.#uploadBandwidth.reset();
	}
};
//#endregion
//#region src/stats-tick.ts
/**
* 统计心跳驱动器
*
* 由入口层创建（持有统计引擎与轮询周期），装配层与句柄
* 共享同一实例；订阅 / 退订即为渲染器的启停开关
*/
var StatsTicker = class {
	#engine;
	#intervalMs;
	#subscribers = /* @__PURE__ */ new Set();
	#timer;
	/**
	* @param engine - 统计引擎（快照数据源）
	* @param intervalMs - 心跳周期（毫秒）
	*/
	constructor(engine, intervalMs) {
		this.#engine = engine;
		this.#intervalMs = intervalMs;
	}
	/**
	* 订阅统计心跳（首个订阅者启动定时器）
	*
	* 订阅即同步送达一次当前快照：渲染器与 headless 消费者
	* 无需等待下一个心跳周期即可完成首帧渲染
	*
	* @param callback - 心跳回调
	* @returns 取消订阅函数（最后一个订阅者退订时停止定时器）
	*/
	subscribe(callback) {
		this.#subscribers.add(callback);
		this.#ensureTimer();
		callback(this.#engine.snapshot());
		return () => {
			this.#subscribers.delete(callback);
			if (this.#subscribers.size === 0) this.#stopTimer();
		};
	}
	/** 清空全部订阅并停止定时器（播放器销毁时调用） */
	destroy() {
		this.#subscribers.clear();
		this.#stopTimer();
	}
	#ensureTimer() {
		if (this.#timer !== void 0) return;
		this.#timer = setInterval(() => this.#tick(), this.#intervalMs);
	}
	#stopTimer() {
		if (this.#timer === void 0) return;
		clearInterval(this.#timer);
		this.#timer = void 0;
	}
	#tick() {
		const snapshot = this.#engine.snapshot();
		for (const callback of this.#subscribers) callback(snapshot);
	}
};
//#endregion
//#region src/config.ts
/**
* 解析对象形式的 ui 配置
*
* setting 未配置视为开启（仍受宿主 option.setting 门控）
*
* @param ui - 用户传入的 ui 对象
* @returns 设置开关组挂载开关
*/
function resolveUIOptions(ui) {
	return ui.setting !== false;
}
/**
* 解析设置开关组的单项显示配置
*
* - true / 省略：三项全显
* - false：全部隐藏（等效整组不挂载）
* - 对象：按项解析，未指定的项默认显示
*
* @param setting - 用户传入的 setting 配置
* @returns 三项显示开关（已含默认值）
*/
function resolveSettingItems(setting) {
	if (setting === void 0 || setting === true) return {
		p2pEnabled: true,
		uploadOnly: true,
		stats: true
	};
	if (setting === false) return {
		p2pEnabled: false,
		uploadOnly: false,
		stats: false
	};
	return {
		p2pEnabled: setting.p2pEnabled ?? true,
		uploadOnly: setting.uploadOnly ?? true,
		stats: setting.stats ?? true
	};
}
/**
* 解析插件选项：填充默认值并归一化 stats / ui / badge 开关
*
* 仅做归一化，不修改任何透传配置的内容；
* core / tracker / hls 原样保留给引擎层合并
*
* @param options - 用户传入的插件选项
* @returns 下游模块可直接消费的解析后选项
*/
function resolveOptions(options) {
	const uiEnabled = options.ui !== false;
	let settingEnabled;
	let settingItems;
	if (typeof options.ui === "object" && options.ui !== null) {
		settingEnabled = resolveUIOptions(options.ui);
		settingItems = resolveSettingItems(options.ui.setting);
	} else {
		settingEnabled = uiEnabled;
		settingItems = resolveSettingItems(uiEnabled ? void 0 : false);
	}
	return {
		typeName: options.type ?? "m3u8",
		fatalRetryMax: options.fatalRetryMax ?? 2,
		fatalNotice: options.fatalNotice === true,
		p2pEnabled: options.enabled ?? true,
		uploadEnabled: options.uploadEnabled ?? true,
		uiEnabled,
		statsEnabled: uiEnabled && options.stats !== false,
		badgeEnabled: uiEnabled && options.stats !== false && options.badge === true,
		settingEnabled,
		settingItems,
		core: options.core,
		tracker: options.tracker,
		hls: options.hls
	};
}
/**
* 合并 core 配置与 tracker 快捷配置组
*
* tracker 组字段与 CoreConfig 同名，浅合并且优先级高于 core；
* 两组皆未配置时返回空对象，保持 p2p-media-loader 官方默认行为
*
* @param options - 含 core / tracker 配置的选项（结构化子集即可）
* @returns 传给 HlsJsP2PEngine 的 core 配置
*/
function mergeCoreConfig(options) {
	return {
		...options.core,
		...options.tracker
	};
}
/**
* 将插件运行时开关状态注入 core 配置
*
* isP2PDisabled / isP2PUploadDisabled 由插件开关状态接管
* （最高优先级）：保证 fatal 重建、换源、重连后重建的实例
* 携带与用户当前选择一致的模式，不因重建而静默丢失开关状态；
* 宿主表达初始意图应使用 enabled / uploadEnabled 选项
*
* @param config - mergeCoreConfig 合并后的 core 配置
* @param p2pEnabled - 当前 P2P 开关状态
* @param uploadEnabled - 当前上传开关状态
* @returns 注入开关状态后的 core 配置
*/
function applyRuntimeToggle(config, p2pEnabled, uploadEnabled) {
	return {
		...config,
		isP2PDisabled: !p2pEnabled,
		isP2PUploadDisabled: !uploadEnabled
	};
}
//#endregion
export { P2P_EVENT_BRIDGE_MAP as C, I18N_MESSAGES as S, BandwidthCalculator as T, I18N_KEY_STATE_DISABLED as _, P2PStatsEngine as a, I18N_KEY_STATS as b, DEFAULT_TYPE as c, I18N_KEY_PANEL_DOWNLOAD as d, I18N_KEY_PANEL_RATIO as f, I18N_KEY_PEERS_UNIT as g, I18N_KEY_PANEL_UPLOAD as h, StatsTicker as i, I18N_KEY_FATAL_NOTICE as l, I18N_KEY_PANEL_TOTAL as m, mergeCoreConfig as n, BANDWIDTH_WINDOW_MS as o, I18N_KEY_PANEL_STATE as p, resolveOptions as r, DEFAULT_FATAL_RETRY_MAX as s, applyRuntimeToggle as t, I18N_KEY_P2P_ENABLED as u, I18N_KEY_STATE_RUNNING as v, STATS_POLLING_MS as w, I18N_KEY_UPLOAD_ONLY as x, I18N_KEY_STATE_UPLOAD_ONLY as y };
