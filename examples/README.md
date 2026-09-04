# examples · 场景化示例

每个示例单一主题、单文件自包含、零构建——双击即可在浏览器打开
（或经任意静态服务器访问，如 `npx serve examples`）。

仓库内示例引用构建脚本同步到 `vendor/` 的最新产物（`npm run build` 自动维护）；
上线时把示例中的本地 `vendor/` 引用替换为 npm CDN 地址即可：

```
https://cdn.jsdelivr.net/npm/artplayer-plugin-p2p@latest/dist/artplayer-plugin-p2p.iife.js
```

| 示例                               | 主题                      | 接入形态 |
| -------------------------------- | ----------------------- | ---- |
| [basic.html](./basic.html)       | 最小接入：三个 script 标签启用 P2P | IIFE |
| [esm.html](./esm.html)           | ES 模块接入与 importmap 依赖映射 | ESM  |
| [switches.html](./switches.html) | 无损动态开关（不断流切换 P2P / 上传）  | IIFE |
| [i18n.html](./i18n.html)         | 界面文案多语言与覆写              | IIFE |
| [badge.html](./badge.html)       | 数据徽章：点击展开详情、心跳消费        | IIFE |
| [events.html](./events.html)     | p2p:\* 事件消费（透传参数形态）     | IIFE |

## 注意事项

- `type` 选项须与插件 customType 注册名一致（默认 `m3u8`），名字脱节则 P2P 不接管

- `lang` 仅在显式选择时传入：宿主以展开合并选项，显式传 `undefined` 也会覆盖内置默认

- ESM 形态下 hls.js 版本须落在插件 `peerDependencies` 声明范围（`^1.7.0`），
  与宿主共享同一实例是 p2p 引擎接管播放器的前提

- esm.html 的引擎包依赖 esm.sh 的 `?bundle` 形态规避 CJS 互操作缺陷；
  CDN 模块为强缓存，若修改 importmap 后仍复现旧错误，请 Ctrl+F5 强制刷新

