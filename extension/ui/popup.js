/**
 * ui/popup.js
 * 弹窗逻辑：开始/停止监听、捕获全部开关、打开监控页等快捷操作。
 */

import { sendMessage, showToast, copyToClipboard, renderThemeSwitch } from "./ui_common.js";
import { MSG } from "../common/constants.js";
import { THEMES, initTheme, setTheme } from "./theme.js";

const statusText = document.getElementById("statusText");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const captureAllBox = document.getElementById("captureAll");
const btnOpenMonitor = document.getElementById("btnOpenMonitor");
const btnCopyCookies = document.getElementById("btnCopyCookies");

/**
 * 根据监听状态刷新界面。
 * @param {boolean} monitoring 是否监听中
 */
function renderStatus(monitoring) {
  statusText.textContent = monitoring ? "监听中" : "未监听";
  statusText.className = "status-tag " + (monitoring ? "status-on" : "status-off");
  btnStart.disabled = monitoring;
  btnStop.disabled = !monitoring;
}

// 初始化：读取后台状态
async function init() {
  // 主题：读取并应用，渲染选择器
  const themeKey = await initTheme();
  renderThemeSwitch("themeSwitch", THEMES, themeKey, (key) => setTheme(key));

  const res = await sendMessage(MSG.GET_STATUS);
  if (res.success) {
    renderStatus(res.data.monitoring);
    captureAllBox.checked = !!res.data.captureAll;
  } else {
    showToast(res.message, "error");
  }
}

// 开始监听
btnStart.addEventListener("click", async () => {
  const res = await sendMessage(MSG.START_MONITOR);
  showToast(res.message, res.success ? "success" : "error");
  if (res.success) renderStatus(true);
});

// 停止监听
btnStop.addEventListener("click", async () => {
  const res = await sendMessage(MSG.STOP_MONITOR);
  showToast(res.message, res.success ? "success" : "error");
  if (res.success) renderStatus(false);
});

// 切换捕获全部
captureAllBox.addEventListener("change", async () => {
  const res = await sendMessage(MSG.TOGGLE_CAPTURE_ALL, { captureAll: captureAllBox.checked });
  showToast(res.message, res.success ? "success" : "error");
  if (!res.success) captureAllBox.checked = !captureAllBox.checked;
});

// 打开独立监控页
btnOpenMonitor.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("ui/monitor.html") });
});

// 一键复制当前页面 Cookie：后台获取并序列化，弹窗写入剪贴板
btnCopyCookies.addEventListener("click", async () => {
  const res = await sendMessage(MSG.COPY_COOKIES);
  if (!res.success) {
    showToast(res.message, "error");
    return;
  }
  const copied = await copyToClipboard(res.data.cookieStr);
  showToast(
    copied ? `已复制 ${res.data.count} 个 Cookie 到剪贴板` : "复制失败，请手动复制",
    copied ? "success" : "error"
  );
});

init();
