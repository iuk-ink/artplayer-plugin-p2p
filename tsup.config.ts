import path from 'node:path'
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    // 标准库产物：四个运行时依赖外部化，与宿主共享实例（npm/打包器接入路径）
    entry: ['src/index.ts', 'src/pure.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: false,
    external: [
      'artplayer',
      'hls.js',
      'p2p-media-loader-core',
      'p2p-media-loader-hlsjs',
    ],
    outExtension: ({ format }) => ({
      js: format === 'esm' ? '.mjs' : '.js',
    }),
  },
  {
    // IIFE 产物：全部依赖内联，传统 <script> 标签接入路径。
    // 自挂载全局（iife.ts 内完成），不使用 globalName：
    // esbuild 的 globalName 挂载的是模块命名空间对象而非 default 导出
    entry: { 'artplayer-plugin-p2p': 'src/iife.ts' },
    format: ['iife'],
    // 浏览器平台解析依赖的 browser 字段，规避 process.stderr 等 Node 专用代码
    platform: 'browser',
    minify: true,
    clean: false,
    sourcemap: false,
    // 浏览器环境无 process，替换依赖链中的环境判断
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    outExtension: () => ({ js: '.iife.js' }),
    // 同步插件产物至 demo/vendor，使 demo 目录自包含：
    // 双击 index.html（file://）或整目录静态托管均可直接演示
    async onSuccess() {
      const fs = await import('node:fs')
      const targetDir = path.join(process.cwd(), 'demo', 'vendor')
      fs.mkdirSync(targetDir, { recursive: true })
      fs.copyFileSync(
        path.join(process.cwd(), 'dist', 'artplayer-plugin-p2p.iife.js'),
        path.join(targetDir, 'artplayer-plugin-p2p.iife.js'),
      )
    },
  },
])
