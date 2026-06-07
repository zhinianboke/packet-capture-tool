/**
 * background/cdp_session.js
 * chrome.debugger（CDP）命令与事件的封装：
 * - attach/detach 单个调试目标；
 * - sendCommand 以 Promise 形式发送 CDP 命令；
 * - 订阅 onEvent 与 onDetach，向上层分发。
 * 统一捕获并转换错误，避免控制台抛出未处理异常（规范第 4 条）。
 */

// 使用的 CDP 协议版本
const PROTOCOL_VERSION = "1.3";

export class CdpSession {
  /**
   * @param {(source:object, method:string, params:object) => void} onEvent CDP 事件回调
   * @param {(source:object, reason:string) => void} onDetach 目标分离回调
   */
  constructor(onEvent, onDetach) {
    this._onEvent = onEvent;
    this._onDetach = onDetach;
    // 绑定一次以便后续 add/removeListener
    this._eventHandler = (source, method, params) => {
      if (this._onEvent) this._onEvent(source, method, params);
    };
    this._detachHandler = (source, reason) => {
      if (this._onDetach) this._onDetach(source, reason);
    };
    this._registered = false;
  }

  /**
   * 注册全局事件监听（仅注册一次）。
   */
  registerListeners() {
    if (this._registered) return;
    chrome.debugger.onEvent.addListener(this._eventHandler);
    chrome.debugger.onDetach.addListener(this._detachHandler);
    this._registered = true;
  }

  /**
   * 注销全局事件监听。
   */
  unregisterListeners() {
    if (!this._registered) return;
    chrome.debugger.onEvent.removeListener(this._eventHandler);
    chrome.debugger.onDetach.removeListener(this._detachHandler);
    this._registered = false;
  }

  /**
   * 附加到调试目标。
   * @param {chrome.debugger.Debuggee} target 形如 { tabId } 或 { targetId }
   * @returns {Promise<void>}
   */
  attach(target) {
    return new Promise((resolve, reject) => {
      chrome.debugger.attach(target, PROTOCOL_VERSION, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  /**
   * 从调试目标分离（移除调试器横幅）。
   * @param {chrome.debugger.Debuggee} target
   * @returns {Promise<void>}
   */
  detach(target) {
    return new Promise((resolve) => {
      chrome.debugger.detach(target, () => {
        // 分离失败（如目标已关闭）忽略错误，避免控制台报错
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  /**
   * 发送 CDP 命令，返回结果 Promise。
   * @param {chrome.debugger.Debuggee} target 目标（tabId 或 sessionId 形式）
   * @param {string} method CDP 方法名，如 "Network.enable"
   * @param {object} [params] 命令参数
   * @returns {Promise<object>}
   */
  sendCommand(target, method, params = {}) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(target, method, params, (result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result || {});
      });
    });
  }
}
