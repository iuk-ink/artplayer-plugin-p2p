(function() {

//#region demo/demo.ts
	(function() {
		"use strict";
		/**
		* 按 id 取页面元素（页面契约：所引用的 id 均存在于 index.html）
		*
		* @param id - 元素 id
		*/
		const $ = function(id) {
			return document.getElementById(id);
		};
		const logEl = $("log");
		/** 当前插件句柄（art.plugins.artplayerPluginP2P） */
		let handle = null;
		/** 当前源标记（换源交替用） */
		let currentSource = "A";
		/** 对照统计轮询句柄 */
		let statsTimer = 0;
		/** 格式化字节数显示 */
		function formatBytes(bytes) {
			if (bytes >= 1073741824) return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
			if (bytes >= 1048576) return (bytes / 1024 / 1024).toFixed(2) + " MB";
			if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
			return Math.round(bytes) + " B";
		}
		/** 格式化速率显示 */
		function formatSpeed(bytesPerSecond) {
			return formatBytes(bytesPerSecond) + "/s";
		}
		/**
		* 更新 chip 元素的文本与信号 tone
		*
		* @param el chip 元素
		* @param text 文本
		* @param tone data-tone（success / warning / info / danger / neutral）
		*/
		function setChip(el, text, tone) {
			if (!el) return;
			el.textContent = text;
			el.setAttribute("data-tone", tone);
		}
		/**
		* 更新播放器面板窗口条的状态点与文本
		*
		* @param text 状态文本
		* @param tone badge-dot 的 data-tone
		*/
		function setPlayerState(text, tone) {
			$("player-state-dot").setAttribute("data-tone", tone);
			$("player-state-text").textContent = text;
		}
		/** 追加事件日志行（上限 200 条，超出裁剪旧日志；用户上翻查看时暂停自动滚动） */
		function appendLog(name, payload, level) {
			const placeholder = logEl.querySelector(".log-empty");
			if (placeholder) placeholder.remove();
			const isNearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
			const line = document.createElement("div");
			line.className = "log-line" + (level ? " is-" + level : "");
			const time = document.createElement("span");
			time.className = "log-time";
			time.textContent = (/* @__PURE__ */ new Date()).toLocaleTimeString();
			const nameEl = document.createElement("span");
			nameEl.className = "log-name";
			nameEl.textContent = name;
			const payloadEl = document.createElement("span");
			payloadEl.textContent = payload;
			line.appendChild(time);
			line.appendChild(nameEl);
			line.appendChild(payloadEl);
			logEl.appendChild(line);
			if (logEl.children.length > 200) {
				const oldest = logEl.firstChild;
				if (oldest) logEl.removeChild(oldest);
			}
			if (isNearBottom) logEl.scrollTop = logEl.scrollHeight;
			$("log-count").textContent = String(logEl.children.length);
		}
		/** 安全序列化事件参数（截断防刷屏） */
		function stringifyArgs(args) {
			try {
				return JSON.stringify(args).slice(0, 140);
			} catch {
				return "[unserializable]";
			}
		}
		/**
		* 生成配置摘要（创建日志用），仅列显式传入的项
		*
		* @param options 插件选项
		* @returns 摘要文本
		*/
		function describeOptions(options) {
			const parts = [];
			if (options.enabled === false) parts.push("enabled:false");
			if (options.uploadEnabled === false) parts.push("uploadEnabled:false");
			if (options.stats === false) parts.push("stats:false");
			if (options.badge) parts.push("badge:true");
			if (options.ui === false) parts.push("ui:false");
			else if (options.ui && typeof options.ui === "object" && options.ui.setting !== void 0) parts.push("setting:" + JSON.stringify(options.ui.setting));
			if (options.core && options.core.swarmId) parts.push("swarmId:自定义");
			if (options.tracker) parts.push("tracker:" + (options.tracker.announceTrackers?.length ?? 0) + "个");
			if (options.hls) parts.push("maxBufferLength:" + String(options.hls.maxBufferLength));
			if (options.type) parts.push("type:" + options.type);
			if (options.fatalRetryMax !== void 0) parts.push("fatalRetryMax:" + options.fatalRetryMax);
			return parts.length ? parts.join(" · ") : "默认配置";
		}
		/**
		* 读取表单中插件注册的格式名有效值
		*
		* customType 的查找键是宿主 option.type（urlMix 以 option.type 优先于
		* URL 扩展名），宿主与插件必须使用同一个名字，否则回调永不触发；
		* 空值收敛为默认名，供宿主选项与插件选项共用
		*
		* @returns 有效的 customType 格式名
		*/
		function resolveTypeName() {
			return $("opt-type").value.trim() || "m3u8";
		}
		/** 按页面表单构建插件选项（仅显式传非默认值，忠实演示配置项语义） */
		function buildOptions() {
			const options = {};
			if (!$("opt-enabled").checked) options.enabled = false;
			if (!$("opt-upload").checked) options.uploadEnabled = false;
			if (!$("opt-ui").checked) options.ui = false;
			if (!$("opt-stats").checked) options.stats = false;
			if ($("opt-badge").checked) options.badge = true;
			if (options.ui === void 0) {
				const items = {
					p2pEnabled: $("opt-set-p2p").checked,
					uploadOnly: $("opt-set-upload").checked,
					stats: $("opt-set-stats").checked
				};
				if (!(items.p2pEnabled || items.uploadOnly || items.stats)) options.ui = { setting: false };
				else if (!items.p2pEnabled || !items.uploadOnly || !items.stats) options.ui = { setting: items };
			}
			const swarmId = $("opt-swarmid").value.trim();
			if (swarmId) options.core = { swarmId };
			const trackers = $("opt-tracker").value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
			if (trackers.length) options.tracker = { announceTrackers: trackers };
			const buffer = Number($("opt-buffer").value);
			if (buffer > 0 && buffer !== 30) options.hls = { maxBufferLength: buffer };
			const type = resolveTypeName();
			if (type !== "m3u8") options.type = type;
			const retryRaw = $("opt-retry").value.trim();
			if (retryRaw !== "") {
				const retry = Number(retryRaw);
				if (retry >= 0 && retry !== 2) options.fatalRetryMax = retry;
			}
			return options;
		}
		/** 销毁当前播放器并复位句柄 */
		function destroyPlayer() {
			if (window.art) {
				window.art.destroy();
				window.art = null;
			}
			handle = null;
			$("player").innerHTML = "";
			stopStatsPolling();
			setPlayerState("未创建", "danger");
		}
		/** 绑定播放器与插件的全量事件日志 */
		function bindEvents(art) {
			[
				"p2p:peerConnect",
				"p2p:peerClose",
				"p2p:peerError",
				"p2p:peerWarning",
				"p2p:peerConnectError",
				"p2p:chunkDownloaded",
				"p2p:chunkUploaded",
				"p2p:segmentLoaded",
				"p2p:segmentError",
				"p2p:segmentAbort",
				"p2p:segmentStart",
				"p2p:streamAdded",
				"p2p:streamRegistrationError",
				"p2p:trackerError",
				"p2p:trackerWarning"
			].forEach((name) => {
				art.on(name, function(...args) {
					const level = name.indexOf("Error") >= 0 ? "error" : name.indexOf("Warning") >= 0 ? "warn" : "";
					appendLog(name, stringifyArgs(args), level);
				});
			});
			art.on("p2p:stateChange", (details) => {
				appendLog("p2p:stateChange", "P2P " + (details.p2pEnabled ? "开" : "关") + " / 上传 " + (details.uploadEnabled ? "开" : "关"), "info");
			});
			art.on("p2p:fatalError", function(...args) {
				appendLog("p2p:fatalError", stringifyArgs(args), "error");
			});
			art.on("ready", () => {
				setPlayerState("播放中", "success");
				appendLog("player:ready", "静音自动播放", "info");
			});
			art.on("restart", (url) => {
				appendLog("player:restart", url, "info");
			});
			art.on("error", (_error, count) => {
				appendLog("player:error", "重连第 " + count + " 次", "warn");
			});
			art.on("destroy", () => {
				appendLog("player:destroy", "播放器已销毁（WS 应无残留连接）", "warn");
			});
		}
		/**
		* 同步换源按钮文案：按钮始终显示"下一次换源的目标源"
		*
		* 文字置于独立 span，避免覆盖按钮内的 Lucide 图标
		*/
		function updateSwitchButton() {
			const target = currentSource === "A" ? "B" : "A";
			$("btn-switch-text").textContent = "换源到 " + target;
		}
		/** 创建播放器（销毁旧实例后按当前表单配置重建） */
		function createPlayer() {
			destroyPlayer();
			const url = currentSource === "A" ? $("stream-a").value.trim() : $("stream-b").value.trim();
			const pluginOptions = buildOptions();
			const art = new Artplayer({
				container: "#player",
				url,
				type: resolveTypeName(),
				autoplay: true,
				muted: true,
				playsInline: true,
				setting: true,
				fullscreen: true,
				fullscreenWeb: true,
				miniProgressBar: true,
				pip: true,
				screenshot: true,
				playbackRate: true,
				aspectRatio: true,
				flip: true,
				airplay: true,
				lock: true,
				gesture: true,
				autoOrientation: true,
				hotkey: true,
				theme: "#5b6bff",
				plugins: [artplayerPluginP2P(pluginOptions)]
			});
			window.art = art;
			handle = art.plugins.artplayerPluginP2P;
			setPlayerState("初始化", "warning");
			updateSwitchButton();
			bindEvents(art);
			startStatsPolling();
			appendLog("player:create", "源 " + currentSource + " · " + describeOptions(pluginOptions), "info");
		}
		/** 换源：art.url 赋值走 customType 回调（验证重入安全与模式保持） */
		function switchSource() {
			if (!window.art) {
				appendLog("console", "请先创建播放器", "warn");
				return;
			}
			currentSource = currentSource === "A" ? "B" : "A";
			const url = currentSource === "A" ? $("stream-a").value.trim() : $("stream-b").value.trim();
			window.art.url = url;
			updateSwitchButton();
			appendLog("console", "发起换源 → 源 " + currentSource, "info");
		}
		function renderStats() {
			if (!handle) {
				[
					"stat-peers",
					"stat-p2p",
					"stat-http",
					"stat-upload",
					"stat-total"
				].forEach((id) => {
					$(id).textContent = "—";
				});
				setChip($("stat-peers-chip"), "idle", "neutral");
				setChip($("stat-p2p-chip"), "—", "neutral");
				setChip($("stat-http-chip"), "—", "neutral");
				setChip($("stat-upload-chip"), "—", "neutral");
				setChip($("handle-p2p"), "—", "neutral");
				setChip($("handle-upload"), "—", "neutral");
				setChip($("handle-badge"), "—", "neutral");
				return;
			}
			const s = handle.getStats();
			const p2pOn = handle.isP2PEnabled();
			const uploadOn = handle.isUploadEnabled();
			const badgeOn = handle.isBadgeVisible();
			$("stat-peers").textContent = s.peers + " / " + s.peakPeers;
			$("stat-p2p").textContent = formatBytes(s.p2pDownloadedBytes);
			$("stat-http").textContent = formatBytes(s.httpDownloadedBytes);
			$("stat-upload").textContent = formatBytes(s.uploadedBytes);
			$("stat-total").textContent = formatBytes(s.totalDownloadedBytes);
			setChip($("stat-peers-chip"), s.peers > 0 ? "connected" : p2pOn ? "waiting" : "off", s.peers > 0 ? "success" : p2pOn ? "info" : "danger");
			setChip($("stat-p2p-chip"), p2pOn ? Math.round(s.p2pDownloadRatio * 100) + "%" : "off", p2pOn ? "success" : "neutral");
			setChip($("stat-http-chip"), formatSpeed(s.downloadSpeed), "neutral");
			setChip($("stat-upload-chip"), uploadOn ? formatSpeed(s.uploadSpeed) : "已关闭", uploadOn ? "warning" : "neutral");
			setChip($("handle-p2p"), p2pOn ? "开启" : "关闭", p2pOn ? "success" : "danger");
			setChip($("handle-upload"), uploadOn ? "开启" : "关闭", uploadOn ? "success" : "neutral");
			setChip($("handle-badge"), badgeOn ? "显示" : "隐藏", badgeOn ? "success" : "neutral");
		}
		function startStatsPolling() {
			stopStatsPolling();
			renderStats();
			statsTimer = window.setInterval(renderStats, 1e3);
		}
		function stopStatsPolling() {
			if (statsTimer) {
				window.clearInterval(statsTimer);
				statsTimer = 0;
			}
			renderStats();
		}
		$("btn-create").addEventListener("click", createPlayer);
		$("btn-switch").addEventListener("click", switchSource);
		$("btn-reload").addEventListener("click", () => {
			if (!handle) {
				appendLog("console", "请先创建播放器", "warn");
				return;
			}
			handle.reload();
			appendLog("console", "handle.reload() 已调用", "info");
		});
		$("btn-destroy").addEventListener("click", () => {
			if (!window.art) {
				appendLog("console", "播放器未创建", "warn");
				return;
			}
			destroyPlayer();
		});
		$("btn-toggle-p2p").addEventListener("click", () => {
			if (!handle) {
				appendLog("console", "请先创建播放器", "warn");
				return;
			}
			handle.setP2PEnabled(!handle.isP2PEnabled());
		});
		$("btn-toggle-upload").addEventListener("click", () => {
			if (!handle) {
				appendLog("console", "请先创建播放器", "warn");
				return;
			}
			handle.setUploadEnabled(!handle.isUploadEnabled());
		});
		$("btn-toggle-badge").addEventListener("click", () => {
			if (!handle) {
				appendLog("console", "请先创建播放器", "warn");
				return;
			}
			handle.setBadgeVisible(!handle.isBadgeVisible());
			appendLog("console", "handle.setBadgeVisible(" + handle.isBadgeVisible() + ") 已调用", "info");
		});
		$("btn-apply-config").addEventListener("click", () => {
			appendLog("console", "按当前插件配置重建播放器", "info");
			createPlayer();
		});
		if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
		createPlayer();
	})();

//#endregion
})();