/**
 * IIFE 构建专用入口
 *
 * 自挂载形式：模块执行时将插件工厂直接赋值到全局，
 * 使传统 <script> 加载后 window.artplayerPluginP2P 即为可调用函数
 * （对齐 ArtPlayer 官方插件的 IIFE 形态）
 *
 * 注意：本入口不使用任何 export——esbuild 的 IIFE globalName
 * 挂载的是模块命名空间对象而非 default 导出，故改为自挂载
 *
 * @module iife
 */

import artplayerPluginP2P from './index'

/** 全局对象（浏览器与 Worker 通用） */
const root = globalThis as typeof globalThis & { artplayerPluginP2P?: unknown }

root.artplayerPluginP2P = artplayerPluginP2P
