/**
 * ui/monitor.js
 * 独立监控页逻辑：请求列表渲染与实时刷新、详情展示、工具栏（监听/导出/清空/开关）、
 * 一键进入表单。通过长连接端口订阅后台推送事件。
 */

import { sendMessage, showToast, escapeHtml, setLoading, copyToClipboard, renderThemeSwitch } from "./ui_common.js";
import { MSG, EVENT, PORT_NAME, FILTER_GROUPS } from "../common/constants.js";
import { matchesFilter } from "../common/filters.js";
import { toFetchCode } from "../common/fetch_format.js";
import { THEMES, initTheme, setTheme, watchThemeChange } from "./theme.js";

// 内存中的记录数组（与列表 DOM 对应）
let records = [];
// 当前选中记录的 id
let selectedId = null;
// 当前筛选状态：类型分组 key 与 URL 关键字
let filterGroup = "all";
let filterKeyword = "";

// 列表最多保留的行数上限：超出时移除最老的记录与行，防止海量请求导致 DOM 膨胀卡顿。
// 注意：这仅限制界面显示，后台 IndexedDB 仍全量保存，导出不受影响。
const MAX_LIST_ROWS = 2000;

const listEl = document.getElementById("recordList");
const emptyTip = document.getElementById("emptyTip");
const detailPanel = document.getElementById("detailPanel");
const statusText = document.getElementById("statusText");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const captureAllBox = document.getElementById("captureAll");
const filterTagsEl = document.getElementById("filterTags");
const filterKeywordEl = document.getElementById("filterKeyword");
const filterCountEl = document.getElementById("filterCount");

/* ---------------- 状态与列表渲染 ---------------- */

/** 根据监听状态刷新顶部按钮 */
function renderStatus(monitoring) {
  statusText.textContent = monitoring ? "监听中" : "未监听";
  statusText.className = "status-tag " + (monitoring ? "status-on" : "status-off");
  btnStart.disabled = monitoring;
  btnStop.disabled = !monitoring;
}

/** 切换空提示显示（按当前筛选后的可见行数判断） */
function refreshEmptyTip() {
  const visible = listEl.querySelectorAll(".list-row:not([hidden])").length;
  emptyTip.hidden = visible > 0;
  emptyTip.textContent = records.length === 0 ? "暂无请求记录" : "没有符合筛选条件的请求";
}

/** 更新筛选结果计数（显示 / 总数） */
function refreshFilterCount() {
  const visible = listEl.querySelectorAll(".list-row:not([hidden])").length;
  filterCountEl.textContent = `显示 ${visible} / 共 ${records.length} 条`;
}

/**
 * 从北京时间 ISO 字符串提取时分秒（HH:MM:SS）用于列表紧凑显示。
 * 完整时间仍保留在 record.timestamp 中（详情与导出使用）。
 * @param {string} ts ISO 时间字符串
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts) return "-";
  // 形如 2026-06-05T12:34:56.789+08:00，取 T 后的时分秒
  const m = String(ts).match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : String(ts);
}

/**
 * 创建单条记录的列表行元素。
 * @param {object} record 请求记录
 * @returns {HTMLElement}
 */
function createRow(record) {
  const row = document.createElement("div");
  row.className = "list-row";
  row.dataset.id = record.id;
  const statusCls = record.status == null ? "st-none" : record.status >= 400 ? "st-err" : "st-ok";
  // 重定向记录加标识，URL 后附跳转目标
  const redirectTag = record.isRedirect ? `<span class="redirect-tag" title="重定向跳转">↳ 重定向</span>` : "";
  // 用户可见内容均经 HTML 转义防 XSS（规范第 22 条）
  row.innerHTML =
    `<span class="col col-time" title="${escapeHtml(record.timestamp)}">${escapeHtml(formatTime(record.timestamp))}</span>` +
    `<span class="col col-method">${escapeHtml(record.method)}</span>` +
    `<span class="col col-url" title="${escapeHtml(record.url)}">${redirectTag}${escapeHtml(record.url)}</span>` +
    `<span class="col col-status ${statusCls}">${escapeHtml(record.status == null ? "-" : record.status)}</span>`;
  row.addEventListener("click", () => selectRecord(record.id, row));
  // 右键弹出菜单（复制为 fetch 等）
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, record.id);
  });
  // 不匹配当前筛选条件的行直接隐藏
  if (!matchesFilter(record, filterGroup, filterKeyword)) row.hidden = true;
  return row;
}

/** 追加一条记录到列表（需求 3.2）：最新记录插到最上面，按当前筛选决定是否可见 */
function appendRecord(record) {
  records.push(record);
  // 最新在最上面：插入到列表头部
  listEl.insertBefore(createRow(record), listEl.firstChild);
  // 超出上限时移除最老的记录（数组头部）与对应的最底部行，防止 DOM 无限膨胀
  if (records.length > MAX_LIST_ROWS) {
    records.shift();
    if (listEl.lastChild) listEl.removeChild(listEl.lastChild);
  }
  refreshEmptyTip();
  refreshFilterCount();
}

/** 全量渲染列表（最新记录在最上面） */
function renderList() {
  listEl.innerHTML = "";
  // 倒序渲染：数组尾部（最新）排在最前
  for (let i = records.length - 1; i >= 0; i--) {
    listEl.appendChild(createRow(records[i]));
  }
  refreshEmptyTip();
  refreshFilterCount();
}

/** 对已有行重新应用筛选（仅切换显隐，不重建 DOM） */
function applyFilter() {
  for (const row of listEl.querySelectorAll(".list-row")) {
    const id = Number(row.dataset.id);
    const record = records.find((r) => r.id === id);
    row.hidden = !(record && matchesFilter(record, filterGroup, filterKeyword));
  }
  refreshEmptyTip();
  refreshFilterCount();
}

/** 渲染筛选类型标签 */
function renderFilterTags() {
  filterTagsEl.innerHTML = "";
  for (const group of FILTER_GROUPS) {
    const tag = document.createElement("button");
    tag.className = "filter-tag" + (group.key === filterGroup ? " active" : "");
    tag.textContent = group.label;
    tag.dataset.key = group.key;
    tag.addEventListener("click", () => {
      filterGroup = group.key;
      for (const t of filterTagsEl.querySelectorAll(".filter-tag")) {
        t.classList.toggle("active", t.dataset.key === filterGroup);
      }
      applyFilter();
    });
    filterTagsEl.appendChild(tag);
  }
}

/* ---------------- 详情渲染（需求 3.3） ---------------- */

/** 选中某行并展示详情 */
function selectRecord(id, rowEl) {
  selectedId = id;
  for (const el of listEl.querySelectorAll(".list-row.selected")) {
    el.classList.remove("selected");
  }
  if (rowEl) rowEl.classList.add("selected");
  const record = records.find((r) => r.id === id);
  if (record) renderDetail(record);
}

/** 渲染一个详情区块 */
function detailBlock(title, content) {
  return (
    `<section class="detail-block">` +
    `<h3 class="detail-title">${escapeHtml(title)}</h3>` +
    `<pre class="detail-pre">${escapeHtml(content)}</pre>` +
    `</section>`
  );
}

/** 将对象/值格式化为可读文本 */
function fmt(v) {
  if (v == null) return "";
  return typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
}

/** 渲染选中记录的请求头、请求参数、响应头、响应体、Set-Cookie（需求 3.3） */
function renderDetail(record) {
  const setCookieText = (record.setCookies || []).join("\n");
  detailPanel.innerHTML =
    `<div class="detail-meta">` +
    `<div><strong>方法：</strong>${escapeHtml(record.method)}</div>` +
    `<div><strong>状态码：</strong>${escapeHtml(record.status == null ? "-" : record.status)}</div>` +
    `<div><strong>资源类型：</strong>${escapeHtml(record.resourceType)}</div>` +
    `<div><strong>时间：</strong>${escapeHtml(record.timestamp)}</div>` +
    `<div class="detail-url"><strong>URL：</strong>${escapeHtml(record.url)}</div>` +
    (record.isRedirect
      ? `<div class="detail-url"><strong>重定向至：</strong>${escapeHtml(record.redirectTo || "")}</div>`
      : "") +
    `</div>` +
    detailBlock("请求头", fmt(record.requestHeaders)) +
    detailBlock("查询参数", fmtQuery(record.queryParams)) +
    detailBlock("请求体参数", fmt(record.postData)) +
    detailBlock("响应头", fmt(record.responseHeaders)) +
    detailBlock(
      "响应体" + (record.bodyTruncated ? "（已截断）" : ""),
      fmt(record.responseBody)
    ) +
    detailBlock("Set-Cookie", setCookieText);
}

/** 将查询参数数组格式化为「名=值」多行文本 */
function fmtQuery(params) {
  if (!Array.isArray(params) || params.length === 0) return "";
  return params.map((p) => `${p.name} = ${p.value}`).join("\n");
}

/* ---------------- 后台通信 ---------------- */

/** 初始化：读取状态与已存记录（需求 7.2） */
async function init() {
  // 主题：读取并应用，渲染选择器
  const themeKey = await initTheme();
  renderThemeSwitch("themeSwitch", THEMES, themeKey, (key) => setTheme(key));
  // 其他页面切换主题时同步当前页面与选择器选中态
  watchThemeChange((key) =>
    renderThemeSwitch("themeSwitch", THEMES, key, (k) => setTheme(k))
  );

  renderFilterTags();
  const statusRes = await sendMessage(MSG.GET_STATUS);
  if (statusRes.success) {
    renderStatus(statusRes.data.monitoring);
    captureAllBox.checked = !!statusRes.data.captureAll;
  }
  const recRes = await sendMessage(MSG.GET_RECORDS);
  if (recRes.success) {
    records = recRes.data.records || [];
    // 初次加载若记录过多，仅保留最新的 MAX_LIST_ROWS 条用于显示（后台仍全量保存）
    if (records.length > MAX_LIST_ROWS) {
      records = records.slice(records.length - MAX_LIST_ROWS);
    }
    renderList();
  } else {
    showToast(recRes.message, "error");
  }
  connectPort();
}

/** 建立长连接端口，订阅后台推送事件 */
function connectPort() {
  const port = chrome.runtime.connect({ name: PORT_NAME });
  port.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === EVENT.NEW_RECORD) {
      appendRecord(msg.payload);
    } else if (msg.type === EVENT.ATTACH_FAILED) {
      showToast(msg.payload.message, "error", 4000);
    } else if (msg.type === EVENT.STATUS_CHANGED) {
      renderStatus(msg.payload.monitoring);
    }
  });
  // 断开后尝试重连（worker 回收等场景）
  port.onDisconnect.addListener(() => {
    setTimeout(connectPort, 1000);
  });
}

/* ---------------- 右键菜单（复制为 fetch 等） ---------------- */

const ctxMenuEl = document.getElementById("ctxMenu");
// 当前右键选中的记录 id
let ctxTargetId = null;

/**
 * 在指定坐标打开右键菜单。
 * @param {number} x 视口横坐标
 * @param {number} y 视口纵坐标
 * @param {number} recordId 目标记录 id
 */
function openContextMenu(x, y, recordId) {
  ctxTargetId = recordId;
  ctxMenuEl.hidden = false;
  // 先显示再测量尺寸，避免超出视口右/下边界
  const rect = ctxMenuEl.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 4);
  const top = Math.min(y, window.innerHeight - rect.height - 4);
  ctxMenuEl.style.left = Math.max(0, left) + "px";
  ctxMenuEl.style.top = Math.max(0, top) + "px";
}

/** 关闭右键菜单 */
function closeContextMenu() {
  ctxMenuEl.hidden = true;
  ctxTargetId = null;
}

// 点击菜单项执行对应复制动作
ctxMenuEl.addEventListener("click", async (e) => {
  const item = e.target.closest(".ctx-item");
  if (!item) return;
  const action = item.dataset.action;
  const record = records.find((r) => r.id === ctxTargetId);
  closeContextMenu();
  if (!record) return;

  let text = "";
  let label = "";
  if (action === "copyFetch") {
    text = toFetchCode(record);
    label = "已复制为 fetch";
  } else if (action === "copyUrl") {
    text = record.url || "";
    label = "已复制 URL";
  } else if (action === "copyResponse") {
    text = record.responseBody == null ? "" : String(record.responseBody);
    label = "已复制响应体";
  }
  const ok = await copyToClipboard(text);
  showToast(ok ? label : "复制失败，请手动复制", ok ? "success" : "error");
});

// 点击别处或滚动/按 Esc 时关闭菜单
document.addEventListener("click", (e) => {
  if (!ctxMenuEl.hidden && !ctxMenuEl.contains(e.target)) closeContextMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeContextMenu();
});
listEl.addEventListener("scroll", () => {
  if (!ctxMenuEl.hidden) closeContextMenu();
});

/* ---------------- 工具栏与表单事件 ---------------- */

btnStart.addEventListener("click", async () => {
  const res = await sendMessage(MSG.START_MONITOR);
  showToast(res.message, res.success ? "success" : "error");
  if (res.success) renderStatus(true);
});

btnStop.addEventListener("click", async () => {
  const res = await sendMessage(MSG.STOP_MONITOR);
  showToast(res.message, res.success ? "success" : "error");
  if (res.success) renderStatus(false);
});

captureAllBox.addEventListener("change", async () => {
  const res = await sendMessage(MSG.TOGGLE_CAPTURE_ALL, { captureAll: captureAllBox.checked });
  showToast(res.message, res.success ? "success" : "error");
  if (!res.success) captureAllBox.checked = !captureAllBox.checked;
});

// URL 关键字筛选：输入即时过滤
filterKeywordEl.addEventListener("input", () => {
  filterKeyword = filterKeywordEl.value;
  applyFilter();
});

/**
 * 将后台返回的导出内容用 Blob 落盘（普通文档环境支持 createObjectURL）。
 * CSV 追加 UTF-8 BOM，避免 Excel 打开中文乱码。
 * @param {{content:string,filename:string,mime:string}} data 导出数据
 */
function downloadExport(data) {
  const isCsv = (data.mime || "").includes("csv");
  const parts = isCsv ? ["\uFEFF", data.content] : [data.content];
  const blob = new Blob(parts, { type: `${data.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = data.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 释放对象 URL
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

document.getElementById("btnExportJson").addEventListener("click", async () => {
  setLoading(true);
  const res = await sendMessage(MSG.EXPORT_JSON);
  setLoading(false);
  if (res.success && res.data && res.data.content != null) {
    downloadExport(res.data);
    showToast(`已导出 ${res.data.count} 条记录`, "success");
  } else {
    showToast(res.message, "error");
  }
});

document.getElementById("btnExportCsv").addEventListener("click", async () => {
  setLoading(true);
  const res = await sendMessage(MSG.EXPORT_CSV);
  setLoading(false);
  if (res.success && res.data && res.data.content != null) {
    downloadExport(res.data);
    showToast(`已导出 ${res.data.count} 条记录`, "success");
  } else {
    showToast(res.message, "error");
  }
});

document.getElementById("btnClear").addEventListener("click", async () => {
  setLoading(true);
  const res = await sendMessage(MSG.CLEAR_RECORDS);
  setLoading(false);
  showToast(res.message, res.success ? "success" : "error");
  if (res.success) {
    records = [];
    selectedId = null;
    renderList();
    detailPanel.innerHTML = `<div class="detail-empty">选择左侧某条请求查看详情</div>`;
  }
});

// 一键复制当前页面 Cookie：后台获取并序列化，界面写入剪贴板
document.getElementById("btnCopyCookies").addEventListener("click", async () => {
  setLoading(true);
  const res = await sendMessage(MSG.COPY_COOKIES);
  setLoading(false);
  if (!res.success) {
    showToast(res.message, "error");
    return;
  }
  const copied = await copyToClipboard(res.data.cookieStr);
  if (copied) {
    // 同时回填到 Cookie 输入框，方便直接用于一键进入
    document.getElementById("enterCookie").value = res.data.cookieStr;
    showToast(`已复制 ${res.data.count} 个 Cookie 到剪贴板`, "success");
  } else {
    showToast("复制失败，请手动复制", "error");
  }
});

// 一键进入（需求 5）
document.getElementById("btnEnter").addEventListener("click", async () => {
  const url = document.getElementById("enterUrl").value;
  const cookieStr = document.getElementById("enterCookie").value;
  const domainsRaw = document.getElementById("enterDomains").value;
  // 需求 5.6：网址为空时提示并取消
  if (!url || !url.trim()) {
    showToast("请输入网址", "error");
    return;
  }
  const extraDomains = domainsRaw
    ? domainsRaw.split(",").map((d) => d.trim()).filter(Boolean)
    : [];
  setLoading(true);
  const res = await sendMessage(MSG.ENTER_ACTION, { url, cookieStr, extraDomains });
  setLoading(false);
  showToast(res.message, res.success ? "success" : "error");
});

init();
