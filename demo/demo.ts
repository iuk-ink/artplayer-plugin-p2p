/**
 * artplayer-plugin-p2p 验证页逻辑（TypeScript 源码）
 *
 * 由构建脚本转译为 demo/demo.js（传统 script 标签产物），
 * 页面仍加载 dist IIFE 构建产物（黑盒验证 <script> 用户的真实交付路径）。
 * 选项对象显式标注 P2POptions 类型：拼错的选项名在编译期即报错，
 * demo 因此成为 API 的第一消费者与最敏感的回归探针。
 * 页面职责：创建 / 销毁 / 换源 / 重建播放器、句柄直控无损开关、
 * 对照统计轮询（与播放器内面板数值核对）、全量事件日志
 */

import type { P2PPluginHandle, P2POptions, P2PStats } from '../src/types/index'

/** CDN script 注入的全局播放器构造器（demo 不做强类型化宿主） */
declare const Artplayer: any

/** dist IIFE 产物注入的全局插件工厂 */
declare const artplayerPluginP2P: import('../src/types/handle').P2PPluginFactory

declare global {
  interface Window {
    /** 当前播放器实例（控制台调试入口） */
    art: any
    /** Lucide 图标库（CDN script 注入） */
    lucide?: { createIcons?: () => void }
  }
}

;(function () {
  'use strict'

  /**
   * 按 id 取页面元素（页面契约：所引用的 id 均存在于 index.html）
   *
   * @param id - 元素 id
   */
  const $ = function <T extends Element = HTMLElement>(id: string): T {
    // 页面契约保证 id 存在，非空由契约约定；宽断言承载 SVG 等非 HTML 元素
    return document.getElementById(id) as unknown as T
  }
  const logEl = $('log')

  /** 当前插件句柄（art.plugins.artplayerPluginP2P） */
  let handle: P2PPluginHandle | null = null
  /** 当前源标记（换源交替用） */
  let currentSource: 'A' | 'B' = 'A'
  /** p2p:statsTick 事件计数（演示事件推送，不写入日志防刷屏） */
  let statsTickCount = 0
  /** 对照统计轮询句柄 */
  let statsTimer = 0

  // ====================================================================
  //  辅助函数
  // ====================================================================

  /** 格式化字节数显示 */
  function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB'
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return Math.round(bytes) + ' B'
  }

  /** 格式化速率显示 */
  function formatSpeed(bytesPerSecond: number): string {
    return formatBytes(bytesPerSecond) + '/s'
  }

  /**
   * 更新 chip 元素的文本与信号 tone
   *
   * @param el chip 元素
   * @param text 文本
   * @param tone data-tone（success / warning / info / danger / neutral）
   */
  function setChip(el: HTMLElement | null, text: string, tone: string): void {
    if (!el) return
    el.textContent = text
    el.setAttribute('data-tone', tone)
  }

  /**
   * 更新播放器面板窗口条的状态点与文本
   *
   * @param text 状态文本
   * @param tone badge-dot 的 data-tone
   */
  function setPlayerState(text: string, tone: string): void {
    $('player-state-dot').setAttribute('data-tone', tone)
    $('player-state-text').textContent = text
  }

  /** 追加事件日志行（上限 200 条，超出裁剪旧日志；用户上翻查看时暂停自动滚动） */
  function appendLog(name: string, payload: string, level?: string): void {
    const placeholder = logEl.querySelector('.log-empty')
    if (placeholder) placeholder.remove()

    const isNearBottom
      = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40

    const line = document.createElement('div')
    line.className = 'log-line' + (level ? ' is-' + level : '')

    const time = document.createElement('span')
    time.className = 'log-time'
    time.textContent = new Date().toLocaleTimeString()

    const nameEl = document.createElement('span')
    nameEl.className = 'log-name'
    nameEl.textContent = name

    const payloadEl = document.createElement('span')
    payloadEl.textContent = payload

    line.appendChild(time)
    line.appendChild(nameEl)
    line.appendChild(payloadEl)
    logEl.appendChild(line)
    if (logEl.children.length > 200) {
      const oldest = logEl.firstChild
      if (oldest) logEl.removeChild(oldest)
    }
    if (isNearBottom) logEl.scrollTop = logEl.scrollHeight

    $('log-count').textContent = String(logEl.children.length)
  }

  /** 安全序列化事件参数（截断防刷屏） */
  function stringifyArgs(args: unknown[]): string {
    try {
      return JSON.stringify(args).slice(0, 140)
    } catch {
      return '[unserializable]'
    }
  }

  // ====================================================================
  //  插件选项构建
  // ====================================================================

  /**
   * 生成配置摘要（创建日志用），仅列显式传入的项
   *
   * @param options 插件选项
   * @returns 摘要文本
   */
  function describeOptions(options: P2POptions): string {
    const parts: string[] = []
    if (options.enabled === false) parts.push('enabled:false')
    if (options.uploadEnabled === false) parts.push('uploadEnabled:false')
    if (options.stats === false) parts.push('stats:false')
    if (options.badge) parts.push('badge:true')
    if (options.fatalNotice) parts.push('fatalNotice:true')
    if (options.ui === false) {
      parts.push('ui:false')
    } else if (options.ui && typeof options.ui === 'object' && options.ui.setting !== undefined) {
      parts.push('setting:' + JSON.stringify(options.ui.setting))
    }
    if (options.core && options.core.swarmId) parts.push('swarmId:自定义')
    if (options.tracker) parts.push('tracker:' + (options.tracker.announceTrackers?.length ?? 0) + '个')
    if (options.hls) parts.push('maxBufferLength:' + String(options.hls.maxBufferLength))
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
   * @returns 有效的 customType 格式名
   */
  function resolveTypeName(): string {
    return $<HTMLInputElement>('opt-type').value.trim() || 'm3u8'
  }

  /** 按页面表单构建插件选项（仅显式传非默认值，忠实演示配置项语义） */
  function buildOptions(): P2POptions {
    const options: P2POptions = {}

    if (!$<HTMLInputElement>('opt-enabled').checked) options.enabled = false
    if (!$<HTMLInputElement>('opt-upload').checked) options.uploadEnabled = false

    // 总闸与统计展示
    if (!$<HTMLInputElement>('opt-ui').checked) options.ui = false
    if (!$<HTMLInputElement>('opt-stats').checked) options.stats = false

    // 右上角数据徽章（ui / stats 总闸关闭时不生效）
    if ($<HTMLInputElement>('opt-badge').checked) options.badge = true

    // fatal 恢复耗尽时经 notice 提示（默认关闭）
    if ($<HTMLInputElement>('opt-fatal-notice').checked) options.fatalNotice = true

    // 设置开关组按项显示（ui 总闸关闭时不生效，跳过收集）
    if (options.ui === undefined) {
      const items = {
        p2pEnabled: $<HTMLInputElement>('opt-set-p2p').checked,
        uploadOnly: $<HTMLInputElement>('opt-set-upload').checked,
        stats: $<HTMLInputElement>('opt-set-stats').checked,
      }
      const anyVisible = items.p2pEnabled || items.uploadOnly || items.stats
      if (!anyVisible) {
        options.ui = { setting: false }
      } else if (!items.p2pEnabled || !items.uploadOnly || !items.stats) {
        // 三项全显时省略字段，保持与默认行为一致
        options.ui = { setting: items }
      }
    }

    // P2P 网络：core 与 tracker 为浅合并关系，tracker 组优先
    const swarmId = $<HTMLInputElement>('opt-swarmid').value.trim()
    if (swarmId) options.core = { swarmId }

    const trackers = $<HTMLInputElement>('opt-tracker').value
      .split(/[\s,]+/)
      .map(item => item.trim())
      .filter(Boolean)
    if (trackers.length) options.tracker = { announceTrackers: trackers }

    // hls.js 透传配置
    const buffer = Number($<HTMLInputElement>('opt-buffer').value)
    if (buffer > 0 && buffer !== 30) options.hls = { maxBufferLength: buffer }

    // 插件行为（type 省略时插件默认同 m3u8，宿主侧由 resolveTypeName 对齐）
    const type = resolveTypeName()
    if (type !== 'm3u8') options.type = type
    const retryRaw = $<HTMLInputElement>('opt-retry').value.trim()
    if (retryRaw !== '') {
      const retry = Number(retryRaw)
      if (retry >= 0 && retry !== 2) options.fatalRetryMax = retry
    }

    return options
  }

  // ====================================================================
  //  播放器生命周期
  // ====================================================================

  /** 销毁当前播放器并复位句柄 */
  function destroyPlayer(): void {
    if (window.art) {
      window.art.destroy()
      window.art = null
    }
    handle = null
    $('player').innerHTML = ''
    stopStatsPolling()
    statsTickCount = 0
    setChip($('handle-tick'), '—', 'neutral')
    resetTopology()
    setPlayerState('未创建', 'danger')
  }

  /** 绑定播放器与插件的全量事件日志 */
  function bindEvents(art: any): void {
    const eventNames = [
      'p2p:peerConnect', 'p2p:peerClose', 'p2p:peerError', 'p2p:peerWarning',
      'p2p:peerConnectError', 'p2p:chunkDownloaded', 'p2p:chunkUploaded',
      'p2p:segmentLoaded', 'p2p:segmentError', 'p2p:segmentAbort', 'p2p:segmentStart',
      'p2p:streamAdded', 'p2p:streamRegistrationError',
      'p2p:trackerError', 'p2p:trackerWarning',
    ]
    eventNames.forEach((name) => {
      art.on(name, function (...args: unknown[]) {
        const level = name.indexOf('Error') >= 0
          ? 'error'
          : name.indexOf('Warning') >= 0 ? 'warn' : ''
        appendLog(name, stringifyArgs(args), level)
      })
    })

    art.on('p2p:stateChange', (details: { p2pEnabled: boolean, uploadEnabled: boolean }) => {
      appendLog('p2p:stateChange', 'P2P ' + (details.p2pEnabled ? '开' : '关') + ' / 上传 ' + (details.uploadEnabled ? '开' : '关'), 'info')
    })
    art.on('p2p:fatalError', function (...args: unknown[]) {
      appendLog('p2p:fatalError', stringifyArgs(args), 'error')
    })

    // p2p:statsTick 演示：1Hz 心跳推送统计快照，以计数 + peers 摘要更新 chip（不写入日志防刷屏）
    art.on('p2p:statsTick', (snapshot: P2PStats) => {
      statsTickCount += 1
      setChip($('handle-tick'), '#' + statsTickCount + ' · peers ' + snapshot.peers, 'info')
      // 拓扑图与心跳同拍重绘（速率文本与活跃态刷新）
      topologySnapshot = snapshot
      renderTopology()
    })

    // 节点拓扑数据接线：事件驱动更新聚合状态，图形渲染固定由心跳同拍驱动
    // （chunk 级事件高频，仅改数据不做即时重绘）
    art.on('p2p:peerConnect', (details: { peerId: string }) => {
      const existing = topologyPeers.get(details.peerId)
      if (existing) {
        existing.closingSince = undefined
      } else {
        topologyPeers.set(details.peerId, { downloaded: 0, uploaded: 0, connectedAt: Date.now(), lastActive: Date.now() })
      }
    })
    art.on('p2p:peerClose', (details: { peerId: string }) => {
      const peer = topologyPeers.get(details.peerId)
      if (peer) peer.closingSince = Date.now()
    })
    art.on('p2p:chunkDownloaded', (bytes: number, source: string, peerId?: string) => {
      // HTTP 分片无归属节点（peerId 缺省），流量归源站连线语义
      if (source !== 'p2p' || peerId === undefined) return
      const peer = topologyPeers.get(peerId)
      if (peer) {
        peer.downloaded += bytes
        peer.lastActive = Date.now()
      }
    })
    art.on('p2p:chunkUploaded', (bytes: number, peerId?: string) => {
      if (peerId === undefined) return
      const peer = topologyPeers.get(peerId)
      if (peer) {
        peer.uploaded += bytes
        peer.lastActive = Date.now()
      }
    })

    art.on('ready', () => {
      setPlayerState('播放中', 'success')
      appendLog('player:ready', '静音自动播放', 'info')
    })
    art.on('restart', (url: string) => {
      appendLog('player:restart', url, 'info')
    })
    art.on('error', (_error: unknown, count: number) => {
      appendLog('player:error', '重连第 ' + count + ' 次', 'warn')
    })
    art.on('destroy', () => {
      appendLog('player:destroy', '播放器已销毁（WS 应无残留连接）', 'warn')
    })
  }

  /**
   * 同步换源按钮文案：按钮始终显示"下一次换源的目标源"
   *
   * 文字置于独立 span，避免覆盖按钮内的 Lucide 图标
   */
  function updateSwitchButton(): void {
    const target = currentSource === 'A' ? 'B' : 'A'
    $('btn-switch-text').textContent = '换源到 ' + target
  }

  /** 创建播放器（销毁旧实例后按当前表单配置重建） */
  function createPlayer(): void {
    destroyPlayer()

    const url = currentSource === 'A' ? $<HTMLInputElement>('stream-a').value.trim() : $<HTMLInputElement>('stream-b').value.trim()
    const pluginOptions = buildOptions()
    const lang = $<HTMLSelectElement>('opt-lang').value
    const art = new Artplayer({
      container: '#player',
      url,
      // 与插件 customType 注册名保持一致：urlMix 按 option.type 查回调，名字脱节则 P2P 不接管
      type: resolveTypeName(),

      // 界面语言（i18n 演示）：仅显式选择时传入——宿主以展开合并选项，
      // 显式传 undefined 同样会覆盖内置默认 lang 并使 i18n 初始化失败
      ...(lang ? { lang } : {}),

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
    appendLog('player:create', '源 ' + currentSource + (lang ? ' · lang=' + lang : '') + ' · ' + describeOptions(pluginOptions), 'info')
  }

  /** 换源：art.url 赋值走 customType 回调（验证重入安全与模式保持） */
  function switchSource(): void {
    if (!window.art) {
      appendLog('console', '请先创建播放器', 'warn')
      return
    }
    currentSource = currentSource === 'A' ? 'B' : 'A'
    const url = currentSource === 'A' ? $<HTMLInputElement>('stream-a').value.trim() : $<HTMLInputElement>('stream-b').value.trim()
    window.art.url = url
    updateSwitchButton()
    appendLog('console', '发起换源 → 源 ' + currentSource, 'info')
  }

  // ====================================================================
  //  对照统计轮询（与播放器内面板数值核对）
  // ====================================================================

  function renderStats(): void {
    if (!handle) {
      ;['stat-peers', 'stat-p2p', 'stat-http', 'stat-upload', 'stat-total'].forEach((id) => {
        $(id).textContent = '—'
      })
      setChip($('stat-peers-chip'), 'idle', 'neutral')
      setChip($('stat-p2p-chip'), '—', 'neutral')
      setChip($('stat-http-chip'), '—', 'neutral')
      setChip($('stat-upload-chip'), '—', 'neutral')
      setChip($('handle-p2p'), '—', 'neutral')
      setChip($('handle-upload'), '—', 'neutral')
      setChip($('handle-badge'), '—', 'neutral')
      setChip($('handle-tick'), '—', 'neutral')
      return
    }

    const s = handle.getStats()
    const p2pOn = handle.isP2PEnabled()
    const uploadOn = handle.isUploadEnabled()
    const badgeOn = handle.isBadgeVisible()

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
    setChip($('handle-badge'), badgeOn ? '显示' : '隐藏', badgeOn ? 'success' : 'neutral')
  }

  function startStatsPolling(): void {
    stopStatsPolling()
    renderStats()
    statsTimer = window.setInterval(renderStats, 1000)
  }

  function stopStatsPolling(): void {
    if (statsTimer) {
      window.clearInterval(statsTimer)
      statsTimer = 0
    }
    renderStats()
  }

  // ====================================================================
  //  节点拓扑（事件流自聚合的 peers 网络图，纯 demo 层不涉插件 API）
  // ====================================================================

  /** 单个 P2P 节点的聚合状态（字节为会话累计，事件驱动更新） */
  interface TopologyPeer {
    downloaded: number
    uploaded: number
    connectedAt: number
    lastActive: number
    /** 进入断开流程的时间戳（灰显保留一段时间再移除，防频繁连断闪烁） */
    closingSince?: number
  }

  /** 断开节点灰显保留时长 */
  const TOPOLOGY_CLOSING_MS = 1000
  /** 该时间窗内有传输的节点视为活跃（连线高亮与节点脉冲） */
  const TOPOLOGY_ACTIVE_WINDOW_MS = 1500

  let topologyPeers = new Map<string, TopologyPeer>()
  let topologySnapshot: Pick<P2PStats, 'downloadSpeed' | 'p2pDownloadSpeed' | 'uploadSpeed'> = {
    downloadSpeed: 0,
    p2pDownloadSpeed: 0,
    uploadSpeed: 0,
  }

  /**
   * 渲染拓扑图（全量重建；节点 ≤ 上游 p2pMaxPeers 默认 50，
   * 1Hz 重建开销可忽略，换取零 diff 的简单可靠）
   *
   * 布局为中心放射：SELF 居中、peers 按 id 排序后环形均分
   * （确定性布局，刷新不跳动）、源站节点独立于左上角承接 HTTP 通道；
   * 节点详情经原生 title 提示，悬停即可查看
   */
  function renderTopology(): void {
    const svg = $<SVGSVGElement>('peer-topology')
    const now = Date.now()
    for (const [id, peer] of topologyPeers) {
      if (peer.closingSince !== undefined && now - peer.closingSince > TOPOLOGY_CLOSING_MS) {
        topologyPeers.delete(id)
      }
    }

    const peers = [...topologyPeers.entries()].sort(([a], [b]) => a.localeCompare(b))
    $('topo-count').textContent = peers.length + ' peers'

    const cx = 320
    const cy = 145
    const selfR = 34
    const ringR = peers.length > 0 ? 100 : 0
    const httpActive = topologySnapshot.downloadSpeed > topologySnapshot.p2pDownloadSpeed

    const edges: string[] = []
    const nodes: string[] = []
    const addEdge = (x2: number, y2: number, cls: string): void => {
      edges.push(`<line class="topo-edge ${cls}" x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`)
    }

    // 源站（HTTP）连线
    addEdge(70, 50, httpActive ? 'is-active' : 'is-idle')

    // 单次遍历：连线先行入列（z-order 在节点之下）、节点随后
    peers.forEach(([id, peer], index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / peers.length
      const x = cx + ringR * Math.cos(angle)
      const y = cy + ringR * Math.sin(angle)
      const active = peer.closingSince === undefined && now - peer.lastActive < TOPOLOGY_ACTIVE_WINDOW_MS
      addEdge(x, y, peer.closingSince !== undefined ? 'is-closing' : active ? 'is-active' : 'is-idle')

      const total = peer.downloaded + peer.uploaded
      const radius = total >= 1024 * 1024 ? 12 : total >= 100 * 1024 ? 10 : 8
      const title = `${id.slice(0, 10)}… · ↓ ${formatBytes(peer.downloaded)} · ↑ ${formatBytes(peer.uploaded)} · 连接 ${Math.round((now - peer.connectedAt) / 1000)}s`
      nodes.push(`<g class="topo-node is-peer${active ? ' is-active' : ''}${peer.closingSince !== undefined ? ' is-closing' : ''}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" /><title>${title}</title></g>`)
    })

    // 源站节点（虚线描边区分于 P2P 节点）
    nodes.push('<g class="topo-node is-origin"><circle cx="70" cy="50" r="22" /><text x="70" y="51" text-anchor="middle">源站</text></g>')

    // SELF 节点：圆内仅放短标识与节点计数（宽度可预估不溢出），
    // 实时速率字符串随单位变长，置于圆下方外部
    nodes.push(`<g class="topo-node is-self"><circle cx="${cx}" cy="${cy}" r="${selfR}" /><text class="is-self-label" x="${cx}" y="${cy - 5}" text-anchor="middle">SELF</text><text class="is-self-peers" x="${cx}" y="${cy + 11}" text-anchor="middle">peers ${peers.length}</text></g>`)
    nodes.push(`<text class="topo-self-rate" x="${cx}" y="${cy + selfR + 18}" text-anchor="middle">↓ ${formatSpeed(topologySnapshot.downloadSpeed)}</text>`)

    svg.innerHTML = edges.join('') + nodes.join('')
  }

  /** 复位拓扑状态（播放器销毁时清空节点与图形） */
  function resetTopology(): void {
    topologyPeers = new Map()
    topologySnapshot = { downloadSpeed: 0, p2pDownloadSpeed: 0, uploadSpeed: 0 }
    renderTopology()
  }

  // ====================================================================
  //  控件接线
  // ====================================================================

  $('btn-create').addEventListener('click', createPlayer)
  $('btn-switch').addEventListener('click', switchSource)
  $('btn-reload').addEventListener('click', () => {
    if (!handle) {
      appendLog('console', '请先创建播放器', 'warn')
      return
    }
    handle.reload()
    appendLog('console', 'handle.reload() 已调用', 'info')
  })
  $('btn-destroy').addEventListener('click', () => {
    if (!window.art) {
      appendLog('console', '播放器未创建', 'warn')
      return
    }
    destroyPlayer()
  })
  $('btn-toggle-p2p').addEventListener('click', () => {
    if (!handle) {
      appendLog('console', '请先创建播放器', 'warn')
      return
    }
    handle.setP2PEnabled(!handle.isP2PEnabled())
  })
  $('btn-toggle-upload').addEventListener('click', () => {
    if (!handle) {
      appendLog('console', '请先创建播放器', 'warn')
      return
    }
    handle.setUploadEnabled(!handle.isUploadEnabled())
  })
  $('btn-toggle-badge').addEventListener('click', () => {
    if (!handle) {
      appendLog('console', '请先创建播放器', 'warn')
      return
    }
    handle.setBadgeVisible(!handle.isBadgeVisible())
    appendLog('console', 'handle.setBadgeVisible(' + handle.isBadgeVisible() + ') 已调用', 'info')
  })
  $('btn-apply-config').addEventListener('click', () => {
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
