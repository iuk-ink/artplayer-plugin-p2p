# artplayer-plugin-p2p

[![npm version](https://img.shields.io/npm/v/artplayer-plugin-p2p.svg)](https://www.npmjs.com/package/artplayer-plugin-p2p)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![ArtPlayer](https://img.shields.io/npm/dependency-version/artplayer-plugin-p2p/peer/artplayer?label=artplayer)](https://github.com/zhw2590582/ArtPlayer)
[![hls.js](https://img.shields.io/npm/dependency-version/artplayer-plugin-p2p/peer/hls.js?label=hls.js)](https://github.com/video-dev/hls.js)

[在线演示](https://iuk-ink.github.io/artplayer-plugin-p2p/demo/) · [报告问题](https://github.com/iuk-ink/artplayer-plugin-p2p/issues)

[ArtPlayer](https://github.com/zhw2590582/ArtPlayer) 的 P2P 流媒体加速插件，基于 [p2p-media-loader](https://github.com/Novage/p2p-media-loader)（hls.js 引擎）。

观众之间互相分享分片数据，降低源站与 CDN 带宽成本，提升弱网环境下的播放体验。

## 特性

- **无损动态开关**：运行时切换 P2P / 仅上传模式，不销毁 hls.js 实例、不断流、不重新缓冲

- **模式保持**：换源、重连、fatal 自愈重建后开关状态不丢失

- **三级自愈**：网络级重启加载 → 媒体级软恢复 → 有界销毁重建；重试上限可配置，耗尽后发出 `p2p:fatalError` 交由宿主决策

- **统计可观测**：速率 / 占比 / Peers / 累计流量，面板与 `getStats()` 双通道

- **全量透传**：p2p-media-loader 与 hls.js 配置原样透传，无私有黑盒

- **类型完备**：全部选项、句柄与 15 个引擎 `p2p:*` 事件均有 TypeScript 类型

- **UI 可选**：统计面板 / 设置开关组 / 单项开关均可独立开关

## 安装

```bash
npm install artplayer-plugin-p2p
```

或通过 CDN（自包含 IIFE，内含 hls.js 与 p2p-media-loader）：

```html
<script src="https://cdn.jsdelivr.net/npm/artplayer-plugin-p2p/dist/artplayer-plugin-p2p.iife.js"></script>
<!-- 全局暴露 artplayerPluginP2P -->
```

> ESM/CJS 接入时 hls.js 与 artplayer 为 peerDependency，与宿主共享实例；
> 需要确保宿主环境已安装 `hls.js@^1.7.0` 与 `artplayer@>=5.0.0`。

## 快速开始

```js
import Artplayer from 'artplayer'
import artplayerPluginP2P from 'artplayer-plugin-p2p'

const art = new Artplayer({
  container: '.player',
  url: 'https://example.com/stream.m3u8',
  type: 'm3u8',
  setting: true,
  plugins: [artplayerPluginP2P()],
})
```

无需任何配置即可工作（公共 tracker + WebRTC）。带配置示例：

```js
artplayerPluginP2P({
  enabled: true,
  uploadEnabled: true,
  stats: true,
  ui: { setting: true },
  core: {
    swarmId: 'my-channel-1080p',
  },
  tracker: {
    announceTrackers: ['wss://tracker.openwebtorrent.com'],
    rtcConfig: {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    },
  },
  hls: { maxBufferLength: 30, capLevelToPlayerSize: true },
})
```

## 配置项

### 插件选项 `P2POptions`

| 字段                  | 类型                        | 默认值      | 说明                                                          |
| ------------------- | ------------------------- | -------- | ----------------------------------------------------------- |
| `type`              | `string`                  | `'m3u8'` | customType 注册的格式名（换源重入的识别键）                                 |
| `enabled`           | `boolean`                 | `true`   | P2P 加速初始状态                                                  |
| `uploadEnabled`     | `boolean`                 | `true`   | 上传开关初始状态（false = 仅下载）                                       |
| `stats`             | `boolean`                 | `true`   | 统计面板 + 右键「P2P 统计」入口；false 时仅可编程读取                           |
| `fatalRetryMax`     | `number`                  | `2`      | fatal 错误销毁重建的最大次数                                           |
| `core`              | `Partial<CoreConfig>`     | —        | p2p-media-loader core 配置，原样透传；`isP2PDisabled` / `isP2PUploadDisabled` 由插件开关状态接管 |
| `tracker`           | `P2PTrackerOptions`       | —        | 信令服务器快捷配置组（字段与 core 同名），与 `core` 浅合并且优先                    |
| `hls`               | `Partial<HlsConfig>`      | —        | hls.js 配置，原样透传                                             |
| `ui`                | `boolean \| P2PUIOptions` | `true`   | UI 总闸；`false` 关闭全部 UI 组件                                    |

> `core` 的动态子集（时间窗 / 超时 / 并发数 / 开关等）可经句柄 `applyDynamicConfig()` 在播放中调整；
> `swarmId` 等静态属性由 p2p-media-loader 防篡改，hls.js 配置仅在实例创建时生效。

### UI 选项 `P2PUIOptions`

| 字段        | 类型                                  | 默认值    | 说明        |
| --------- | ----------------------------------- | ------ | --------- |
| `setting` | `boolean \| P2PSettingItemsOptions` | `true` | 设置开关组显示配置 |

设置开关组支持**按项选择性显示**：

- `true` / 省略：三项全显

- `false`：整组不挂载

- 对象：按项控制，未指定的项默认显示

```ts
interface P2PSettingItemsOptions {
  /** 「P2P 加速」开关 */
  p2pEnabled?: boolean
  /** 「仅上传模式」开关 */
  uploadOnly?: boolean
  /** 「P2P 统计」开关（stats: false 时无面板可开，此项不生效） */
  stats?: boolean
}
```

示例：

```js
artplayerPluginP2P({
  // 只显示「P2P 加速」一个开关
  ui: { setting: { uploadOnly: false, stats: false } },
})
```

门控优先级：`ui: false` > `stats: false` > `ui.setting` >
宿主 `option.setting`（宿主未开启设置面板时插件自动跳过挂载）。

## 插件句柄

```js
const handle = art.plugins.artplayerPluginP2P
```

| 成员                                     | 说明                                               |
| -------------------------------------- | ------------------------------------------------ |
| `setP2PEnabled(value)`                 | 无损切换 P2P 加速（不断流、不重建实例）                           |
| `setUploadEnabled(value)`              | 无损切换上传开关                                         |
| `isP2PEnabled()` / `isUploadEnabled()` | 读取当前开关状态                                         |
| `applyDynamicConfig(config)`           | 运行时调整 p2p-media-loader 动态配置                      |
| `getStats()`                           | 统计快照（速率 / 占比 / 峰值 / 累计流量）                        |
| `reload()`                             | 按当前配置重建（保持开关状态与原始 URL）                           |
| `destroy()`                            | 销毁当前播放实例（播放器销毁时引擎随之自动释放）                         |
| `hls`                                  | 当前 hls.js 实例（可与 artplayer-plugin-hls-control 协作） |
| `engine`                               | 当前 p2p-media-loader 引擎实例                         |

## 事件

引擎事件命名与 p2p-media-loader 4.0 官方 `CoreEventMap` 一一对应（编译期穷尽校验），全部带 `p2p:` 前缀：

```js
// p2pml 4.0 事件为单参数对象：PeerDetails { peerId, infoHash, streamType, trackerUrl }
art.on('p2p:peerConnect', (details) => { /* ... */ })
art.on('p2p:stateChange', ({ p2pEnabled, uploadEnabled }) => { /* ... */ })
```

| 分类     | 事件                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 流注册   | `p2p:streamAdded` `p2p:streamRegistrationError`                                                                             |
| 分片生命周期 | `p2p:segmentStart` `p2p:segmentLoaded` `p2p:segmentError` `p2p:segmentAbort`                                              |
| 下载计数   | `p2p:chunkDownloaded` `p2p:chunkUploaded`                                                                                  |
| 对等网络   | `p2p:peerConnect` `p2p:peerConnectError` `p2p:peerClose` `p2p:peerError` `p2p:peerWarning`                                  |
| 信令     | `p2p:trackerError` `p2p:trackerWarning`                                                                                      |
| 插件自身   | `p2p:stateChange`（开关切换）`p2p:fatalError`（fatal 通知与重建耗尽）                                                                     |

## 纯逻辑入口

```js
import { resolveOptions, applyRuntimeToggle, P2PStatsEngine } from 'artplayer-plugin-p2p/pure'
```

不引入 hls.js / DOM 依赖，可在 Node 环境直接使用（统计引擎、带宽计算、选项解析）。

## 开发

```bash
npm install
npm run build      # 构建（IIFE 产物自动同步至 demo/vendor）
npm test           # 聚合测试（pure 单测 + 产物冒烟；需先 npm run build）
npm run typecheck  # 类型检查
```

`demo/` 为自包含演示页：插件产物随仓库提交至 `demo/vendor/`，
克隆仓库后直接双击 `demo/index.html` 即可体验；重新执行 `npm run build`
会自动同步最新产物（构建钩子复制，无需手动维护）。

## License

[MIT](LICENSE)
