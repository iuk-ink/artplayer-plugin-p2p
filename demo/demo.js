/**
 * artplayer-plugin-p2p 验证页逻辑
 *
 * 纯 JS（ES2020+）+ 传统 script 标签接入：加载 dist IIFE 构建产物
 * （黑盒验证 <script> 用户的真实交付路径）。
 * 页面职责：创建 / 销毁 / 换源 / 重建播放器、句柄直控无损开关、
 * 对照统计轮询（与播放器内面板数值核对）、全量事件日志
 */
;(function () {
  'use strict'

  var $ = function (id) { return document.getElementById(id) }
  var logEl = $('log')

  /** 当前插件句柄（art.plugins.artplayerPluginP2P） */
  var handle = null
  /** 当前源标记（换源交替用） */
  var currentSource = 'A'
  /** 对照统计轮询句柄 */
  var statsTimer = 0

  // ====================================================================
  //  辅助函数
  // ====================================================================

  /** 格式化字节数显示 */
  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB'
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return Math.round(bytes) + ' B'
  }

  /** 格式化速率显示 */
  function formatSpeed(bytesPerSecond) {
    return formatBytes(bytesPerSecond) + '/s'
  }

  /**
   * 更新 chip 元素的文本与信号 tone
   *
   * @param {HTMLElement|null} el chip 元素
   * @param {string} text 文本
   * @param {string} tone data-tone（success / warning / info / danger / neutral）
   */
  function setChip(el, text, tone) {
    if (!el) return
    el.textContent = text
    el.setAttribute('data-tone', tone)
  }

  /**
   * 更新播放器面板窗口条的状态点与文本
   *
   * @param {string} text 状态文本
   * @param {string} tone badge-dot 的 data-tone
   */
  function setPlayerState(text, tone) {
    var dot = $('player-state-dot')
    var textEl = $('player-state-text')
    if (dot) dot.setAttribute('data-tone', tone)
    if (textEl) textEl.textContent = text
  }

  /** 追加事件日志行（上限 200 条，超出裁剪旧日志；用户上翻查看时暂停自动滚动） */
  function appendLog(name, payload, level) {
    var placeholder = logEl.querySelector('.log-empty')
    if (placeholder) placeholder.remove()

    var isNearBottom
      = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40

    var line = document.createElement('div')
    line.className = 'log-line' + (level ? ' is-' + level : '')

    var time = document.createElement('span')
    time.className = 'log-time'
    time.textContent = new Date().toLocaleTimeString()

    var nameEl = document.createElement('span')
    nameEl.className = 'log-name'
    nameEl.textContent = name

    var payloadEl = document.createElement('span')
    payloadEl.textContent = payload

    line.appendChild(time)
    line.appendChild(nameEl)
    line.appendChild(payloadEl)
    logEl.appendChild(line)
    if (logEl.children.length > 200) logEl.removeChild(logEl.firstChild)
    if (isNearBottom) logEl.scrollTop = logEl.scrollHeight

    var countChip = $('log-count')
    if (countChip) countChip.textContent = String(logEl.children.length)
  }

  /** 安全序列化事件参数（截断防刷屏） */
  function stringifyArgs(args) {
    try {
      return JSON.stringify(args).slice(0, 140)
    } catch (error) {
      return '[unserializable]'
    }
  }

  // ====================================================================
  //  插件选项构建
  // ====================================================================

  /**
   * 生成配置摘要（创建日志用），仅列显式传入的项
   *
   * @param {object} options 插件选项
   * @returns {string} 摘要文本
   */
  function describeOptions(options) {
    var parts = []
    if (options.enabled === false) parts.push('enabled:false')
    if (options.uploadEnabled === false) parts.push('uploadEnabled:false')
    if (options.stats === false) parts.push('stats:false')
    if (options.ui === false) {
      parts.push('ui:false')
    } else if (options.ui && options.ui.setting !== undefined) {
      parts.push('setting:' + JSON.stringify(options.ui.setting))
    }
    if (options.core && options.core.swarmId) parts.push('swarmId:自定义')
    if (options.tracker) parts.push('tracker:' + options.tracker.announceTrackers.length + '个')
    if (options.hls) parts.push('maxBufferLength:' + options.hls.maxBufferLength)
    if (options.type) parts.push('type:' + options.type)
    if (options.fatalRetryMax !== undefined) parts.push('fatalRetryMax:' + options.fatalRetryMax)
    return parts.length ? parts.join(' · ') : '默认配置'
  }

  /**
   * 读取表单中插件注册的格式名有效值
   *
   * customType 的查找键是宿主 option.type（urlMix 以 option.type 优先于
   * URL 扩展名），宿主与插件必须使用同一个名字，否则回调永不触发；
   * 空值收敛为默认名，供宿主选项与插件选项共用
   *
   * @returns {string} 有效的 customType 格式名
   */
  function resolveTypeName() {
    return $('opt-type').value.trim() || 'm3u8'
  }

  /** 按页面表单构建插件选项（仅显式传非默认值，忠实演示配置项语义） */
  function buildOptions() {
    var options = {}

    if (!$('opt-enabled').checked) options.enabled = false
    if (!$('opt-upload').checked) options.uploadEnabled = false

    // 总闸与统计展示
    if (!$('opt-ui').checked) options.ui = false
    if (!$('opt-stats').checked) options.stats = false

    // 设置开关组按项显示（ui 总闸关闭时不生效，跳过收集）
    if (options.ui === undefined) {
      var items = {
        p2pEnabled: $('opt-set-p2p').checked,
        uploadOnly: $('opt-set-upload').checked,
        stats: $('opt-set-stats').checked,
      }
      var anyVisible = items.p2pEnabled || items.uploadOnly || items.stats
      if (!anyVisible) {
        options.ui = { setting: false }
      } else if (!items.p2pEnabled || !items.uploadOnly || !items.stats) {
        // 三项全显时省略字段，保持与默认行为一致
        options.ui = { setting: items }
      }
    }

    // P2P 网络：core 与 tracker 为浅合并关系，tracker 组优先
    var swarmId = $('opt-swarmid').value.trim()
    if (swarmId) options.core = { swarmId: swarmId }

    var trackers = $('opt-tracker').value
      .split(/[\s,]+/)
      .map(function (item) { return item.trim() })
      .filter(Boolean)
    if (trackers.length) options.tracker = { announceTrackers: trackers }

    // hls.js 透传配置
    var buffer = Number($('opt-buffer').value)
    if (buffer > 0 && buffer !== 30) options.hls = { maxBufferLength: buffer }

    // 插件行为（type 省略时插件默认同 m3u8，宿主侧由 resolveTypeName 对齐）
    var type = resolveTypeName()
    if (type !== 'm3u8') options.type = type
    var retryRaw = $('opt-retry').value.trim()
    if (retryRaw !== '') {
      var retry = Number(retryRaw)
      if (retry >= 0 && retry !== 2) options.fatalRetryMax = retry
    }

    return options
  }

  // ====================================================================
  //  播放器生命周期
  // ====================================================================

  /** 销毁当前播放器并复位句柄 */
  function destroyPlayer() {
    if (window.art) {
      window.art.destroy()
      window.art = null
    }
    handle = null
    $('player').innerHTML = ''
    stopStatsPolling()
    setPlayerState('未创建', 'danger')
  }

  /** 绑定播放器与插件的全量事件日志 */
  function bindEvents(art) {
    var eventNames = [
      'p2p:peerConnect', 'p2p:peerClose', 'p2p:peerError', 'p2p:peerWarning',
      'p2p:peerConnectError', 'p2p:chunkDownloaded', 'p2p:chunkUploaded',
      'p2p:segmentLoaded', 'p2p:segmentError', 'p2p:segmentAbort', 'p2p:segmentStart',
      'p2p:streamAdded', 'p2p:streamRegistrationError',
      'p2p:trackerError', 'p2p:trackerWarning',
    ]
    eventNames.forEach(function (name) {
      art.on(name, function () {
        var args = Array.prototype.slice.call(arguments)
        var level = name.indexOf('Error') >= 0
          ? 'error'
          : name.indexOf('Warning') >= 0 ? 'warn' : ''
        appendLog(name, stringifyArgs(args), level)
      })
    })

    art.on('p2p:stateChange', function (details) {
      appendLog('p2p:stateChange', 'P2P ' + (details.p2pEnabled ? '开' : '关') + ' / 上传 ' + (details.uploadEnabled ? '开' : '关'), 'info')
    })
    art.on('p2p:fatalError', function () {
      var args = Array.prototype.slice.call(arguments)
      appendLog('p2p:fatalError', stringifyArgs(args), 'error')
    })

    art.on('ready', function () {
      setPlayerState('播放中', 'success')
      appendLog('player:ready', '静音自动播放', 'info')
    })
    art.on('restart', function (url) {
      appendLog('player:restart', url, 'info')
    })
    art.on('error', function (error, count) {
      appendLog('player:error', '重连第 ' + count + ' 次', 'warn')
    })
    art.on('destroy', function () {
      appendLog('player:destroy', '播放器已销毁（WS 应无残留连接）', 'warn')
    })
  }

  /**
   * 同步换源按钮文案：按钮始终显示"下一次换源的目标源"
   *
   * 文字置于独立 span，避免覆盖按钮内的 Lucide 图标
   */
  function updateSwitchButton() {
    var target = currentSource === 'A' ? 'B' : 'A'
    var textEl = $('btn-switch-text')
    if (textEl) textEl.textContent = '换源到 ' + target
  }

  /** 创建播放器（销毁旧实例后按当前表单配置重建） */
  function createPlayer() {
    destroyPlayer()

    var url = currentSource === 'A' ? $('stream-a').value.trim() : $('stream-b').value.trim()
    var pluginOptions = buildOptions()
    var art = new Artplayer({
      container: '#player',
      url: url,
      // 与插件 customType 注册名保持一致：urlMix 按 option.type 查回调，名字脱节则 P2P 不接管
      type: resolveTypeName(),

      // 播放行为：自动播放需静音（浏览器自动播放策略），内联播放利于移动端
      autoplay: true,
      muted: true,
      playsInline: true,

      // UI 能力：全屏 / 画中画 / 截图 / 倍速 / 画面比例 / 翻转 / 设置面板
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

      // 移动端能力：手势控制、锁定按钮、全屏自动旋转
      lock: true,
      gesture: true,
      autoOrientation: true,

      // 键盘快捷键（空格 / 方向键）；官方守卫：输入框聚焦时不响应，demo 表单无冲突
      hotkey: true,

      // 主题色与页面 Halo 主色一致
      theme: '#5b6bff',

      plugins: [artplayerPluginP2P(pluginOptions)],
    })
    window.art = art
    handle = art.plugins.artplayerPluginP2P

    setPlayerState('初始化', 'warning')
    updateSwitchButton()
    bindEvents(art)
    startStatsPolling()
    appendLog('player:create', '源 ' + currentSource + ' · ' + describeOptions(pluginOptions), 'info')
  }

  /** 换源：art.url 赋值走 customType 回调（验证重入安全与模式保持） */
  function switchSource() {
    if (!window.art) {
      appendLog('console', '请先创建播放器', 'warn')
      return
    }
    currentSource = currentSource === 'A' ? 'B' : 'A'
    var url = currentSource === 'A' ? $('stream-a').value.trim() : $('stream-b').value.trim()
    window.art.url = url
    updateSwitchButton()
    appendLog('console', '发起换源 → 源 ' + currentSource, 'info')
  }

  // ====================================================================
  //  对照统计轮询（与播放器内面板数值核对，验收⑩）
  // ====================================================================

  function renderStats() {
    if (!handle) {
      ;['stat-peers', 'stat-p2p', 'stat-http', 'stat-upload', 'stat-total'].forEach(function (id) {
        $(id).textContent = '—'
      })
      setChip($('stat-peers-chip'), 'idle', 'neutral')
      setChip($('stat-p2p-chip'), '—', 'neutral')
      setChip($('stat-http-chip'), '—', 'neutral')
      setChip($('stat-upload-chip'), '—', 'neutral')
      setChip($('handle-p2p'), '—', 'neutral')
      setChip($('handle-upload'), '—', 'neutral')
      return
    }

    var s = handle.getStats()
    var p2pOn = handle.isP2PEnabled()
    var uploadOn = handle.isUploadEnabled()

    $('stat-peers').textContent = s.peers + ' / ' + s.peakPeers
    $('stat-p2p').textContent = formatBytes(s.p2pDownloadedBytes)
    $('stat-http').textContent = formatBytes(s.httpDownloadedBytes)
    $('stat-upload').textContent = formatBytes(s.uploadedBytes)
    $('stat-total').textContent = formatBytes(s.totalDownloadedBytes)

    // 速率类指标置于左下角 chip，磁贴主数值只承载字节累计，避免同磁贴内重复展示
    // 信号色始终配文字标签：chip 文本即语义标签
    setChip($('stat-peers-chip'), s.peers > 0 ? 'connected' : p2pOn ? 'waiting' : 'off', s.peers > 0 ? 'success' : p2pOn ? 'info' : 'danger')
    setChip($('stat-p2p-chip'), p2pOn ? Math.round(s.p2pDownloadRatio * 100) + '%' : 'off', p2pOn ? 'success' : 'neutral')
    setChip($('stat-http-chip'), formatSpeed(s.downloadSpeed), 'neutral')
    setChip($('stat-upload-chip'), uploadOn ? formatSpeed(s.uploadSpeed) : '已关闭', uploadOn ? 'warning' : 'neutral')
    setChip($('handle-p2p'), p2pOn ? '开启' : '关闭', p2pOn ? 'success' : 'danger')
    setChip($('handle-upload'), uploadOn ? '开启' : '关闭', uploadOn ? 'success' : 'neutral')
  }

  function startStatsPolling() {
    stopStatsPolling()
    renderStats()
    statsTimer = window.setInterval(renderStats, 1000)
  }

  function stopStatsPolling() {
    if (statsTimer) {
      window.clearInterval(statsTimer)
      statsTimer = 0
    }
    renderStats()
  }

  // ====================================================================
  //  控件接线
  // ====================================================================

  $('btn-create').addEventListener('click', createPlayer)
  $('btn-switch').addEventListener('click', switchSource)
  $('btn-reload').addEventListener('click', function () {
    if (!handle) {
      appendLog('console', '请先创建播放器', 'warn')
      return
    }
    handle.reload()
    appendLog('console', 'handle.reload() 已调用', 'info')
  })
  $('btn-destroy').addEventListener('click', function () {
    if (!window.art) {
      appendLog('console', '播放器未创建', 'warn')
      return
    }
    destroyPlayer()
  })
  $('btn-toggle-p2p').addEventListener('click', function () {
    if (!handle) {
      appendLog('console', '请先创建播放器', 'warn')
      return
    }
    handle.setP2PEnabled(!handle.isP2PEnabled())
  })
  $('btn-toggle-upload').addEventListener('click', function () {
    if (!handle) {
      appendLog('console', '请先创建播放器', 'warn')
      return
    }
    handle.setUploadEnabled(!handle.isUploadEnabled())
  })
  $('btn-apply-config').addEventListener('click', function () {
    appendLog('console', '按当前插件配置重建播放器', 'info')
    createPlayer()
  })

  // 渲染静态 Lucide 图标（design system 指定图标库）
  if (window.lucide && window.lucide.createIcons) {
    window.lucide.createIcons()
  }

  // 页面加载即创建一次（静音自动播放）
  createPlayer()
})()
