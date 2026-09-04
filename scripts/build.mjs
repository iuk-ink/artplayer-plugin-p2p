/**
 * 构建编排脚本
 *
 * 产物原子落盘：全部产物先写入 .staging 目录，四类产物
 * （ESM / CJS / DTS / IIFE）全部成功后原子替换 dist，随后
 * 转译 demo 并同步 vendor；任一步失败删除 .staging，
 * dist 保持上一个完整版本（失败不污染交付物）
 *
 * 构建器为 rolldown（rollup 兼容 API）：
 * - npm 包构建外部化四个运行时依赖，与宿主共享实例
 * - DTS 由 rolldown-plugin-dts 生成并打包声明
 * - IIFE 全依赖内联 + minify（浏览器平台，define 注入版本与环境）
 * - demo.ts 转译为传统 script（页面直接引用）
 *
 * 运行完毕自动退出；失败以非零码结束
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { rolldown } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

const require = createRequire(import.meta.url)
const root = process.cwd()
// createRequire 相对于本脚本（scripts/）所在目录解析，包根在其上一级
const pkg = require('../package.json')

const STAGING = path.join(root, 'dist.staging')
const DIST = path.join(root, 'dist')
const VENDOR = path.join(root, 'demo', 'vendor')
const EXAMPLES_VENDOR = path.join(root, 'examples', 'vendor')

/** npm 包构建的四个运行时外部依赖（与宿主共享实例） */
const EXTERNAL = [
  /^artplayer$/,
  /^hls\.js$/,
  /^p2p-media-loader-core$/,
  /^p2p-media-loader-hlsjs$/,
]

/** 构建期注入：插件版本号（单一来源 package.json） */
const versionDefine = { __ARTP2P_VERSION__: JSON.stringify(pkg.version) }

/** ESM/CJS/DTS 三路共享的入口与外部依赖配置 */
function npmInputOptions(plugins = []) {
  return {
    input: { index: 'src/index.ts', pure: 'src/pure.ts' },
    external: EXTERNAL,
    platform: 'neutral',
    transform: { define: versionDefine },
    plugins,
  }
}

/** ESM + CJS 运行时产物 */
async function buildRuntime() {
  const bundle = await rolldown(npmInputOptions())
  await bundle.write({
    dir: STAGING,
    format: 'es',
    entryFileNames: '[name].mjs',
    chunkFileNames: '[name]-[hash].mjs',
    sourcemap: false,
  })
  await bundle.write({
    dir: STAGING,
    format: 'cjs',
    entryFileNames: '[name].js',
    chunkFileNames: '[name]-[hash].cjs',
    exports: 'named',
    sourcemap: false,
  })
  await bundle.close()
}

/** 合并声明产物（rolldown-plugin-dts 打包 TypeScript 声明） */
async function buildDts() {
  const bundle = await rolldown(npmInputOptions([dts()]))
  await bundle.write({
    dir: STAGING,
    format: 'es',
    entryFileNames: '[name].d.ts',
    chunkFileNames: '[name]-[hash].d.ts',
  })
  await bundle.close()
}

/**
 * IIFE 全依赖内联产物（浏览器平台 + minify）
 *
 * rolldown 会拒绝 IIFE 构建选项中的 transform.define
 * （"Invalid key: Expected never"），因此本构建不走 define，
 * 环境常量与版本号在产物写出后做确定性替换。
 * 替换带计数断言：源码改动导致标记消失时构建显式失败
 */
async function buildIife() {
  const bundle = await rolldown({
    input: { 'artplayer-plugin-p2p': 'src/iife.ts' },
    platform: 'browser',
  })
  await bundle.write({
    dir: STAGING,
    format: 'iife',
    entryFileNames: '[name].iife.js',
    minify: true,
    sourcemap: false,
  })
  await bundle.close()

  const iifeFile = path.join(STAGING, 'artplayer-plugin-p2p.iife.js')
  let code = readFileSync(iifeFile, 'utf8')

  // 浏览器 platform 下 rolldown 会内建注入 process.env.NODE_ENV="production"，
  // 依赖链中通常已无该引用（envCount 可为 0）；版本标记必须存在，缺失即源码漂移
  const envCount = countOccurrences(code, 'process.env.NODE_ENV')
  const versionCount = countOccurrences(code, '__ARTP2P_VERSION__')
  code = code
    .replaceAll('process.env.NODE_ENV', '"production"')
    .replaceAll('__ARTP2P_VERSION__', JSON.stringify(pkg.version))
  writeFileSync(iifeFile, code)

  if (versionCount === 0) {
    throw new Error(`IIFE define replacement failed (env: ${envCount}, version: ${versionCount})`)
  }
}

/** 统计子串出现次数 */
function countOccurrences(haystack, needle) {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/** demo.ts 转译为传统 script（页面直接引用；类型检查由 tsc 承担） */
async function buildDemo() {
  const bundle = await rolldown({
    input: { demo: 'demo/demo.ts' },
    platform: 'browser',
  })
  await bundle.write({
    dir: path.join(root, 'demo'),
    format: 'iife',
    entryFileNames: '[name].js',
    minify: false,
    sourcemap: false,
  })
  await bundle.close()
}

async function main() {
  rmSync(STAGING, { recursive: true, force: true })
  mkdirSync(STAGING, { recursive: true })

  try {
    await buildRuntime()
    await buildDts()
    await buildIife()

    // 原子替换：全部产物就绪后才触碰 dist
    rmSync(DIST, { recursive: true, force: true })
    renameSync(STAGING, DIST)
    console.log('dist written (esm / cjs / dts / iife)')

    // demo 转译与 vendor 同步（失败时 dist 已完整落盘，仅整体退出码置失败）
    if (existsSync(path.join(root, 'demo', 'demo.ts'))) {
      await buildDemo()
      mkdirSync(VENDOR, { recursive: true })
      copyFileSync(
        path.join(DIST, 'artplayer-plugin-p2p.iife.js'),
        path.join(VENDOR, 'artplayer-plugin-p2p.iife.js'),
      )
      console.log('demo compiled, vendor synced')
    }

    // 示例产物同步：examples 目录存在时清空后成套复制——ESM 产物为
    // 「入口 + 共享 chunk」多文件结构（rolldown 双入口构建会提取共享
    // 模块为独立 chunk），且 chunk 文件名含内容 hash、随构建变化，
    // 白名单单文件复制会让页面因 chunk 缺失 404，增量复制会残留旧
    // hash 文件，必须整体替换
    if (existsSync(path.join(root, 'examples'))) {
      rmSync(EXAMPLES_VENDOR, { recursive: true, force: true })
      mkdirSync(EXAMPLES_VENDOR, { recursive: true })
      copyFileSync(
        path.join(DIST, 'artplayer-plugin-p2p.iife.js'),
        path.join(EXAMPLES_VENDOR, 'artplayer-plugin-p2p.iife.js'),
      )
      for (const file of readdirSync(DIST).filter(item => item.endsWith('.mjs'))) {
        copyFileSync(path.join(DIST, file), path.join(EXAMPLES_VENDOR, file))
      }
      console.log('examples vendor synced')
    }
  } catch (error) {
    rmSync(STAGING, { recursive: true, force: true })
    console.error('[build] failed:', error)
    process.exitCode = 1
    return
  }

  console.log('[build] ok')
}

await main()
