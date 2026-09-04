/**
 * 插件事件负载类型契约
 *
 * @module types/events
 */

/**
 * `p2p:stateChange` 事件负载：开关切换后派发，供宿主同步自定义 UI
 */
export interface StateChangeDetails {
  /** 当前 P2P 开关状态 */
  p2pEnabled: boolean
  /** 当前上传开关状态 */
  uploadEnabled: boolean
}
