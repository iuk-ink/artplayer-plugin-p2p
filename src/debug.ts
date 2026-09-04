/**
 * 调试日志模块
 *
 * 开关状态独立持有：入口的 artplayerPluginP2P.DEBUG 静态属性经
 * getter/setter 代理至本模块，UI 层直接导入 log 使用——避免
 * 入口与 UI 层互引造成循环依赖
 *
 * @module debug
 */

let enabled = false

/** 由入口静态属性 setter 代理调用 */
export function setDebugEnabled(value: boolean): void {
  enabled = value
}

export function isDebugEnabled(): boolean {
  return enabled
}

/**
 * 调试日志输出（默认静默，带统一前缀）
 *
 * 用于插件装配细节的按需诊断；错误级诊断（customType 冲突）
 * 应使用 console.warn 并不受本开关控制
 *
 * @param args - 日志内容
 */
export function log(...args: unknown[]): void {
  if (enabled) {
    console.info('[artplayer-plugin-p2p]', ...args)
  }
}
