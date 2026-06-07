/**
 * background/service_worker.js
 * 后台服务工作线程入口：初始化数据存储与捕获引擎，路由界面指令，
 * 通过长连接端口向界面推送事件，管理监听状态与“捕获全部”开关的持久化与保活。
 */

import { DataStore } from "./data_store.js";
import { CaptureEngine } from "./capture_engine.js";
import { inject, serializeCookies } from "./cookie_injector.js";
import { exportJSON, exportCSV } from "./export_module.js";
import {
  MSG,
  EVENT,
  STORAGE_KEYS,
  KEEPALIVE_ALARM,
  PORT_NAME,
} from "../common/constants.js";

// 数据存储实例
const dataStore = new DataStore();

// 当前“捕获全部”开关状态（内存缓存，启动时从 storage 恢复）
let captureAll = false;

// 订阅事件的界面端口集合
const ports = new Set();

/**
 * 向所有已连接界面广播事件。
 * @param {string} type 事件类型（EVENT.*)
 * @param {object} payload 事件数据
 */
function broadcast(type, payload) {
  for (const port of ports) {
    try {
      port.postMessage({ type, payload });
    } catch (e) {
      void e;
    }
  }
}

// 捕获引擎：新记录广播给界面，附加失败广播提示
const captureEngine = new CaptureEngine({
  dataStore,
  onRecord: (record) => broadcast(EVENT.NEW_RECORD, record),
  onAttachFailed: (tabId, message) =>
    broadcast(EVENT.ATTACH_FAILED, { tabId, message: `标签页 ${tabId} 附加失败：${message}` }),
  getCaptureAll: () => captureAll,
});

/**
 * 从 chrome.storage.local 恢复开关与监听状态。worker 重启后调用。
 */
async function restoreState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.CAPTURE_ALL,
    STORAGE_KEYS.MONITORING,
  ]);
  captureAll = !!data[STORAGE_KEYS.CAPTURE_ALL];
  if (data[STORAGE_KEYS.MONITORING] && !captureEngine.isRunning()) {
    await captureEngine.start();
    ensureKeepAlive();
  }
}

/** 启动保活心跳（防止 worker 被回收导致丢失附加状态） */
function ensureKeepAlive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
}

/** 停止保活心跳 */
function clearKeepAlive() {
  chrome.alarms.clear(KEEPALIVE_ALARM);
}

// 保活心跳：触发时确认监听状态仍在（轻量操作即可唤醒 worker）
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    void captureEngine.isRunning();
  }
});

// 启动 / 安装时恢复状态
chrome.runtime.onStartup.addListener(() => {
  restoreState();
});
chrome.runtime.onInstalled.addListener(() => {
  restoreState();
});
// 模块顶层也尝试恢复（worker 被事件唤醒重启时）
restoreState();

// 长连接端口：界面订阅后台推送事件
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});

/**
 * 处理界面指令。返回统一结构 { success, message, data }（参考规范统一响应格式）。
 * @param {object} message { type, payload }
 * @returns {Promise<object>}
 */
async function handleMessage(message) {
  const { type, payload } = message || {};
  switch (type) {
    case MSG.GET_STATUS:
      return ok({ monitoring: captureEngine.isRunning(), captureAll });

    case MSG.START_MONITOR: {
      await captureEngine.start();
      await chrome.storage.local.set({ [STORAGE_KEYS.MONITORING]: true });
      ensureKeepAlive();
      broadcast(EVENT.STATUS_CHANGED, { monitoring: true });
      return ok({ monitoring: true }, "已开始监听");
    }

    case MSG.STOP_MONITOR: {
      await captureEngine.stop();
      await chrome.storage.local.set({ [STORAGE_KEYS.MONITORING]: false });
      clearKeepAlive();
      broadcast(EVENT.STATUS_CHANGED, { monitoring: false });
      return ok({ monitoring: false }, "已停止监听");
    }

    case MSG.GET_RECORDS: {
      const records = await dataStore.getAll();
      return ok({ records });
    }

    case MSG.CLEAR_RECORDS: {
      await dataStore.clear();
      return ok(null, "已清空全部请求记录");
    }

    case MSG.TOGGLE_CAPTURE_ALL: {
      captureAll = !!(payload && payload.captureAll);
      await chrome.storage.local.set({ [STORAGE_KEYS.CAPTURE_ALL]: captureAll });
      return ok({ captureAll }, captureAll ? "已开启捕获全部" : "已关闭捕获全部");
    }

    case MSG.ENTER_ACTION:
      return handleEnterAction(payload || {});

    case MSG.COPY_COOKIES:
      return handleCopyCookies();

    case MSG.EXPORT_JSON:
      return handleExport("json");

    case MSG.EXPORT_CSV:
      return handleExport("csv");

    default:
      return fail("未知指令：" + type);
  }
}

/**
 * 一键进入：注入 Cookie 并打开新标签页（需求 5）。
 */
async function handleEnterAction(payload) {
  const { url, cookieStr, extraDomains } = payload;
  // 需求 5.6：网址为空时提示并取消
  if (!url || !url.trim()) {
    return fail("请输入网址");
  }
  const targetUrl = url.trim();
  const domains = Array.isArray(extraDomains)
    ? extraDomains.map((d) => d.trim()).filter(Boolean)
    : [];

  let injectResult = { total: 0, failed: [] };
  if (cookieStr && cookieStr.trim()) {
    injectResult = await inject(cookieStr, targetUrl, domains);
  }
  await chrome.tabs.create({ url: targetUrl });

  if (injectResult.failed && injectResult.failed.length > 0) {
    return ok(
      injectResult,
      `已打开页面，但有 ${injectResult.failed.length} 个 Cookie 注入失败`
    );
  }
  return ok(injectResult, "已打开页面并注入 Cookie");
}

/**
 * 一键复制：获取目标标签页 URL 下的全部 Cookie 并序列化为字符串返回。
 * 实际写入剪贴板由界面完成（service worker 无剪贴板与 DOM）。
 * 目标标签页选择：优先当前活动标签页；若其为扩展自身页面（如独立监控页），
 * 则回退到最近访问的 http(s) 标签页。
 * @returns {Promise<object>} data.cookieStr 为拼接后的 Cookie 字符串
 */
async function handleCopyCookies() {
  const tab = await resolveTargetTab();
  if (!tab || !tab.url) {
    return fail("未找到可获取 Cookie 的网页标签页");
  }
  if (!/^https?:\/\//i.test(tab.url)) {
    return fail("当前标签页不是网页，无法获取 Cookie");
  }
  // 按 URL 获取该页面在请求时会携带的全部 Cookie（含父域）
  const cookies = await chrome.cookies.getAll({ url: tab.url });
  if (!cookies || cookies.length === 0) {
    return fail("当前标签页没有可复制的 Cookie");
  }
  const cookieStr = serializeCookies(cookies);
  return ok({ cookieStr, count: cookies.length, url: tab.url }, `已获取 ${cookies.length} 个 Cookie`);
}

/**
 * 解析“目标标签页”：当前活动标签页若是 http(s) 网页则直接采用；
 * 否则（如扩展独立监控页）回退到最近访问的 http(s) 标签页。
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function resolveTargetTab() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && active.url && /^https?:\/\//i.test(active.url)) {
    return active;
  }
  // 回退：所有窗口的 http(s) 标签页中取最近访问的一个
  const all = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  if (all.length === 0) return active || null;
  all.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return all[0];
}

/**
 * 导出处理：生成导出文本返回给界面，由界面用 Blob 落盘（避免 data URL 体积限制）。
 * 无记录时提示（需求 4.4）。
 * @param {"json"|"csv"} format
 */
async function handleExport(format) {
  const records = await dataStore.getAll();
  if (!records || records.length === 0) {
    return fail("暂无可导出数据");
  }
  const ts = Date.now();
  if (format === "json") {
    return ok(
      {
        content: exportJSON(records),
        filename: `requests_${ts}.json`,
        mime: "application/json",
        count: records.length,
      },
      "已生成 JSON"
    );
  }
  return ok(
    {
      content: exportCSV(records),
      filename: `requests_${ts}.csv`,
      mime: "text/csv",
      count: records.length,
    },
    "已生成 CSV"
  );
}

/** 统一成功响应 */
function ok(data, message = "成功") {
  return { code: 0, success: true, message, data };
}

/** 统一失败响应（HTTP 仍为 200，业务错误经 success 字段传递，规范第 1 条） */
function fail(message, code = 1) {
  return { code, success: false, message, data: null };
}

// 指令路由：界面通过 sendMessage 发送，异步返回统一结构
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((res) => sendResponse(res))
    .catch((e) => sendResponse(fail(e && e.message ? e.message : String(e))));
  return true; // 异步响应
});
