/**
 * background/capture_engine.js
 * 捕获引擎：基于 chrome.debugger（CDP）附加目标标签页，启用 Network 域采集请求与响应，
 * 通过 Target.setAutoAttach 覆盖 iframe 子框架；组装请求记录后经过滤判定保存并通知界面。
 */

import { CdpSession } from "./cdp_session.js";
import { shouldCapture, shouldCaptureBody, truncateBody, isHtmlContentType } from "../common/filters.js";
import { parseQueryParams } from "../common/url_util.js";
import { nowBeijingISO } from "../common/time_util.js";

// 无法或不应附加调试器的页面前缀：浏览器内置页、扩展自身页、DevTools、空白页等。
// 对这些页面附加会失败并产生噪音提示，故在附加前过滤。
const NON_ATTACHABLE_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "chrome-untrusted://",
  "devtools://",
  "edge://",
  "about:",
  "view-source:",
  "https://chromewebstore.google.com",
  "https://chrome.google.com/webstore",
];

/**
 * 判断某 URL 对应的标签页是否可附加调试器。
 * 空 URL 视为可附加（新标签页导航前 url 可能为空，交由 attach 自身处理）。
 * @param {string} url 标签页 URL
 * @returns {boolean}
 */
function isAttachableUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return !NON_ATTACHABLE_PREFIXES.some((p) => lower.startsWith(p));
}

export class CaptureEngine {
  /**
   * @param {object} deps 依赖项
   * @param {import("./data_store.js").DataStore} deps.dataStore 数据存储
   * @param {(record:object) => void} deps.onRecord 新记录回调（推送给界面）
   * @param {(tabId:number, message:string) => void} deps.onAttachFailed 附加失败回调
   * @param {() => boolean} deps.getCaptureAll 读取“捕获全部”开关的函数
   */
  constructor({ dataStore, onRecord, onAttachFailed, getCaptureAll }) {
    this._dataStore = dataStore;
    this._onRecord = onRecord;
    this._onAttachFailed = onAttachFailed;
    this._getCaptureAll = getCaptureAll;

    // 进行中的请求映射，键为 `${sessionId||tabId}:${requestId}`
    this._pending = new Map();
    // requestWillBeSentExtraInfo 携带的完整请求头（含 Cookie）暂存区，
    // 用于应对该事件早于 requestWillBeSent 到达的乱序场景，键同 pending 键。
    this._extraReqHeaders = new Map();
    // 已附加的标签页集合
    this._attachedTabs = new Set();
    // 正在附加中的标签页集合（同步去重，防止并发重复附加的竞态）
    this._attaching = new Set();
    this._running = false;

    this._session = new CdpSession(
      (source, method, params) => this.onCdpEvent(source, method, params),
      (source) => this._onTargetDetached(source)
    );

    // 监听新标签页（需求 2.2）
    this._onTabCreated = (tab) => {
      if (this._running && tab && tab.id != null) {
        this.attachTab(tab.id, tab.url);
      }
    };
    // 新标签页创建时 url 常为空，导航完成后再尝试附加（需求 2.2 兜底）
    this._onTabUpdated = (tabId, changeInfo, tab) => {
      if (
        this._running &&
        changeInfo.status === "loading" &&
        !this._attachedTabs.has(tabId) &&
        isAttachableUrl(tab && tab.url)
      ) {
        this.attachTab(tabId, tab && tab.url);
      }
    };
  }

  /** 当前是否正在监听 */
  isRunning() {
    return this._running;
  }

  /**
   * 开始监听：附加所有现有标签页并监听新标签页（需求 2.1、2.2）。
   */
  async start() {
    if (this._running) return;
    this._running = true;
    this._session.registerListeners();
    chrome.tabs.onCreated.addListener(this._onTabCreated);
    chrome.tabs.onUpdated.addListener(this._onTabUpdated);

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      // 跳过浏览器内置页、扩展自身页等不可附加页面（需求 2.4：避免噪音误报）
      if (tab.id != null && isAttachableUrl(tab.url)) {
        await this.attachTab(tab.id, tab.url);
      }
    }
  }

  /**
   * 停止监听：detach 所有标签页以移除调试器横幅。
   */
  async stop() {
    if (!this._running) return;
    this._running = false;
    chrome.tabs.onCreated.removeListener(this._onTabCreated);
    chrome.tabs.onUpdated.removeListener(this._onTabUpdated);

    for (const tabId of Array.from(this._attachedTabs)) {
      await this._session.detach({ tabId });
    }
    this._attachedTabs.clear();
    this._pending.clear();
    this._extraReqHeaders.clear();
    this._session.unregisterListeners();
  }

  /**
   * 附加单个标签页：attach -> Network.enable -> Target.setAutoAttach（覆盖 iframe）。
   * 失败时跳过该标签页并通过回调通知界面（需求 2.4）。
   * @param {number} tabId
   * @param {string} [url] 标签页 URL，用于过滤不可附加页面
   */
  async attachTab(tabId, url) {
    if (this._attachedTabs.has(tabId) || this._attaching.has(tabId)) return;
    // 不可附加页面静默跳过，不计入失败提示（需求 2.4）
    if (!isAttachableUrl(url)) return;
    // 同步标记附加中，避免并发事件（onCreated/onUpdated/初始 query）重复附加同一标签页
    this._attaching.add(tabId);
    try {
      await this._session.attach({ tabId });
      this._attachedTabs.add(tabId);
      await this._session.sendCommand({ tabId }, "Network.enable", {});
      // 自动附加子框架（iframe）等子目标，flatten 模式下事件带 sessionId（需求 2.3）
      await this._session.sendCommand({ tabId }, "Target.setAutoAttach", {
        autoAttach: true,
        flatten: true,
        waitForDebuggerOnStart: false,
      });
    } catch (e) {
      this._attachedTabs.delete(tabId);
      const msg = e && e.message ? e.message : String(e);
      if (this._onAttachFailed) this._onAttachFailed(tabId, msg);
    } finally {
      this._attaching.delete(tabId);
    }
  }

  /**
   * CDP 事件分发入口。
   * @param {object} source { tabId, sessionId? }
   * @param {string} method CDP 事件名
   * @param {object} params 事件参数
   */
  onCdpEvent(source, method, params) {
    switch (method) {
      case "Target.attachedToTarget":
        this._onAttachedToTarget(source, params);
        break;
      case "Network.requestWillBeSent":
        this._onRequestWillBeSent(source, params);
        break;
      case "Network.requestWillBeSentExtraInfo":
        this._onRequestExtraInfo(source, params);
        break;
      case "Network.responseReceivedExtraInfo":
        this._onResponseExtraInfo(source, params);
        break;
      case "Network.responseReceived":
        this._onResponseReceived(source, params);
        break;
      case "Network.loadingFinished":
        this._onLoadingFinished(source, params);
        break;
      case "Network.loadingFailed":
        this._onLoadingFailed(source, params);
        break;
      default:
        break;
    }
  }

  /**
   * 子目标（iframe 等）附加后再次启用 Network（需求 2.3）。
   */
  async _onAttachedToTarget(source, params) {
    const sessionId = params && params.sessionId;
    if (!sessionId) return;
    try {
      // flatten 模式下用 { tabId, sessionId } 定位子会话
      const target = { tabId: source.tabId, sessionId };
      await this._session.sendCommand(target, "Network.enable", {});
      await this._session.sendCommand(target, "Target.setAutoAttach", {
        autoAttach: true,
        flatten: true,
        waitForDebuggerOnStart: false,
      });
    } catch (e) {
      // 子目标启用失败不影响主流程，静默忽略避免控制台报错
      void e;
    }
  }

  /** 目标分离时清理状态 */
  _onTargetDetached(source) {
    if (source && source.tabId != null) {
      this._attachedTabs.delete(source.tabId);
    }
  }

  /** 由事件源构造 pending 映射键的前缀 */
  _scopeKey(source) {
    return source && source.sessionId ? source.sessionId : `tab${source.tabId}`;
  }

  /** 由事件源与 requestId 组合 pending 键 */
  _pendingKey(source, requestId) {
    return `${this._scopeKey(source)}:${requestId}`;
  }

  /**
   * requestWillBeSent：建立 pending 记录（URL、方法、请求头、postData、资源类型）。
   */
  _onRequestWillBeSent(source, params) {
    // 提前过滤：捕获全部关闭时，静态资源在此直接丢弃，不建立 pending、不取响应体，
    // 显著降低后台负载（修复静态资源涌入导致的卡顿）。
    const captureAll = this._getCaptureAll ? !!this._getCaptureAll() : false;
    const resourceType = params.type || "Other";
    if (!shouldCapture(resourceType, captureAll)) return;

    const key = this._pendingKey(source, params.requestId);

    // 重定向：同一 requestId 再次触发 requestWillBeSent 并带 redirectResponse（上一跳的响应）。
    // 将上一跳作为一条独立的重定向记录定稿保存，再用新请求信息重建 pending 继续后续跳转。
    if (params.redirectResponse) {
      this._finalizeRedirect(key, params.redirectResponse, params.request && params.request.url);
    }
    const req = params.request || {};
    this._pending.set(key, {
      requestId: params.requestId,
      tabId: source.tabId,
      frameId: params.frameId || "",
      url: req.url || "",
      method: req.method || "",
      resourceType,
      // 从 URL 解析查询参数（GET 参数等），与 postData 一起构成完整请求参数
      queryParams: parseQueryParams(req.url || ""),
      // 浅拷贝请求头，便于后续合并 extraInfo 补充的头（含 Cookie）而不污染事件对象
      requestHeaders: { ...(req.headers || {}) },
      // postData 可能因体积过大而不在事件中直接给出，此时仅标记 hasPostData，
      // 待 loadingFinished 时再用 Network.getRequestPostData 补取（需求 1.1）
      postData: req.postData != null ? req.postData : null,
      hasPostData: !!req.hasPostData,
      status: null,
      responseHeaders: {},
      mimeType: "",
      responseBody: null,
      bodyTruncated: false,
      setCookies: [],
    });

    // 若 requestWillBeSentExtraInfo 已先到达，合并其完整请求头（含 Cookie）后清理缓存
    const earlyHeaders = this._extraReqHeaders.get(key);
    if (earlyHeaders) {
      this._mergeRequestHeaders(this._pending.get(key), earlyHeaders);
      this._extraReqHeaders.delete(key);
    }
  }

  /**
   * requestWillBeSentExtraInfo：携带浏览器底层补充的完整请求头（含 Cookie、User-Agent 等），
   * 这些头不会出现在 requestWillBeSent.request.headers 中，需在此合并。
   * 该事件可能早于 requestWillBeSent 到达，故 pending 不存在时先暂存。
   */
  _onRequestExtraInfo(source, params) {
    const key = this._pendingKey(source, params.requestId);
    const headers = params.headers || {};
    const entry = this._pending.get(key);
    if (entry) {
      this._mergeRequestHeaders(entry, headers);
    } else {
      // pending 尚未建立（事件乱序），暂存待合并
      this._extraReqHeaders.set(key, headers);
    }
  }

  /**
   * 将 extraInfo 的请求头合并进记录的 requestHeaders。
   * requestWillBeSentExtraInfo 是浏览器实际发送的完整头（含 Cookie），对同名头其值更准确，
   * 故以 extraInfo 为准覆盖，并补入 requestWillBeSent 独有的头，取两者并集。
   * @param {object} entry pending 记录
   * @param {object} headers extraInfo 请求头
   */
  _mergeRequestHeaders(entry, headers) {
    if (!entry || !headers) return;
    // 先建立「小写名 -> 原始名」索引，便于按大小写不敏感方式覆盖同名头
    const lowerToOrig = {};
    for (const k of Object.keys(entry.requestHeaders || {})) {
      lowerToOrig[k.toLowerCase()] = k;
    }
    for (const [name, value] of Object.entries(headers)) {
      const orig = lowerToOrig[name.toLowerCase()];
      if (orig) {
        entry.requestHeaders[orig] = value; // 覆盖已有同名头为实际发送值
      } else {
        entry.requestHeaders[name] = value; // 补入新头（如 Cookie）
      }
    }
  }

  /**
   * 从响应头对象中提取 set-cookie 列表（重复值以换行分隔）。
   * @param {object} headers 响应头对象
   * @returns {string[]} set-cookie 字符串数组
   */
  _extractSetCookies(headers) {
    const result = [];
    for (const [name, value] of Object.entries(headers || {})) {
      if (name.toLowerCase() === "set-cookie") {
        for (const line of String(value).split("\n")) {
          if (line.trim()) result.push(line.trim());
        }
      }
    }
    return result;
  }

  /**
   * 重定向定稿：把当前 pending（上一跳请求）连同 redirectResponse（上一跳响应）
   * 组装为一条独立的重定向记录并保存，随后从 pending 中移除（新请求信息稍后重建）。
   * @param {string} key pending 键
   * @param {object} redirectResponse CDP 上一跳响应（含 status、headers、url）
   * @param {string} nextUrl 重定向目标 URL（即下一跳请求 URL）
   */
  _finalizeRedirect(key, redirectResponse, nextUrl) {
    const entry = this._pending.get(key);
    if (!entry) return;
    this._pending.delete(key);
    // 重定向前一跳清理可能暂存的请求头缓存，避免串到下一跳
    this._extraReqHeaders.delete(key);

    const headers = redirectResponse.headers || {};
    entry.status = redirectResponse.status != null ? redirectResponse.status : entry.status;
    // 合并 redirectResponse 的响应头（原始头，含 Location、Set-Cookie 等）
    for (const [name, value] of Object.entries(headers)) {
      if (!(name in entry.responseHeaders)) entry.responseHeaders[name] = value;
    }
    // 解析重定向响应的 Set-Cookie（登录态常在 30x 跳转中下发）
    for (const c of this._extractSetCookies(headers)) entry.setCookies.push(c);
    // 重定向响应无响应体
    entry.responseBody = null;
    entry.bodyTruncated = false;
    // 标记为重定向记录并记录跳转目标，便于界面与导出识别
    entry.isRedirect = true;
    entry.redirectTo = nextUrl || this._headerValue(headers, "location") || "";

    // 复用统一组装与保存逻辑
    void this._finalize(entry);
  }

  /**
   * responseReceivedExtraInfo：提供未经浏览器加工的完整原始响应头（重复同名头以 \n 拼接）。
   * 在此解析原始 set-cookie，并把完整响应头合并进 responseHeaders（补全 responseReceived 可能丢失的重复头）。
   */
  _onResponseExtraInfo(source, params) {
    const key = this._pendingKey(source, params.requestId);
    const entry = this._pending.get(key);
    if (!entry) return;
    const headers = params.headers || {};
    for (const [name, value] of Object.entries(headers)) {
      // 合并响应头：extraInfo 为原始完整头，优先采用其值补全/覆盖
      entry.responseHeaders[name] = value;
    }
    // 解析并累加 set-cookie
    for (const c of this._extractSetCookies(headers)) entry.setCookies.push(c);
  }

  /**
   * responseReceived：合并状态码、响应头、MIME 类型。
   * 响应头采用合并而非覆盖，避免与 responseReceivedExtraInfo 的原始头互相覆盖（保留两者并集）。
   */
  _onResponseReceived(source, params) {
    const key = this._pendingKey(source, params.requestId);
    const entry = this._pending.get(key);
    if (!entry) return;
    const resp = params.response || {};
    entry.status = resp.status != null ? resp.status : null;
    // 合并响应头：以已有头（可能来自 extraInfo 的原始头）为基础，补入此处缺失的头
    const incoming = resp.headers || {};
    const existingLower = new Set(
      Object.keys(entry.responseHeaders || {}).map((k) => k.toLowerCase())
    );
    for (const [name, value] of Object.entries(incoming)) {
      if (!existingLower.has(name.toLowerCase())) {
        entry.responseHeaders[name] = value;
      }
    }
    entry.mimeType = resp.mimeType || entry.mimeType || "";
    if (params.type) entry.resourceType = params.type;
  }

  /**
   * loadingFinished：按 content-type 判定后读取响应体并截断，组装记录后过滤、保存、通知。
   */
  async _onLoadingFinished(source, params) {
    const key = this._pendingKey(source, params.requestId);
    // 无论是否命中 pending，都清理请求头缓存，防止被过滤请求的 extraInfo 缓存泄漏
    this._extraReqHeaders.delete(key);
    const entry = this._pending.get(key);
    if (!entry) return;
    this._pending.delete(key);

    const target = source.sessionId
      ? { tabId: source.tabId, sessionId: source.sessionId }
      : { tabId: source.tabId };

    // 补取大体积 POST 数据：事件未直接给出 postData 但标记了 hasPostData（需求 1.1）
    // 请求体不做截断，保留完整内容
    if (entry.postData == null && entry.hasPostData) {
      try {
        const r = await this._session.sendCommand(target, "Network.getRequestPostData", {
          requestId: params.requestId,
        });
        if (r && r.postData != null) entry.postData = r.postData;
      } catch (e) {
        // 取不到则保持 null，不影响其余字段
        void e;
      }
    }

    // 需求 1.3：仅 json/text 类型采集响应体
    const contentType = entry.mimeType || this._headerValue(entry.responseHeaders, "content-type");
    if (shouldCaptureBody(contentType)) {
      try {
        const result = await this._session.sendCommand(target, "Network.getResponseBody", {
          requestId: params.requestId,
        });
        let body = result.body || "";
        if (result.base64Encoded) {
          // base64 文本解码失败则置空（需求 1.6）
          try {
            body = atob(body);
          } catch (e) {
            body = null;
          }
        }
        // 仅当响应体为 HTML 时才截断，其余类型（JSON、纯文本等）保留完整内容
        if (isHtmlContentType(contentType)) {
          const truncated = truncateBody(body);
          entry.responseBody = truncated;
          entry.bodyTruncated = body != null && truncated !== body;
        } else {
          entry.responseBody = body;
          entry.bodyTruncated = false;
        }
      } catch (e) {
        // 获取响应体失败：置空并保留其余字段（需求 1.6）
        entry.responseBody = null;
      }
    }

    await this._finalize(entry);
  }

  /**
   * loadingFailed：以空响应体组装记录并保存（需求 1.6）。
   */
  async _onLoadingFailed(source, params) {
    const key = this._pendingKey(source, params.requestId);
    // 同步清理请求头缓存，防止泄漏
    this._extraReqHeaders.delete(key);
    const entry = this._pending.get(key);
    if (!entry) return;
    this._pending.delete(key);
    entry.responseBody = null;
    await this._finalize(entry);
  }

  /**
   * 组装最终记录，经 shouldCapture 过滤后保存并通知界面（需求 1.5、6.2、6.3）。
   */
  async _finalize(entry) {
    const captureAll = this._getCaptureAll ? !!this._getCaptureAll() : false;
    if (!shouldCapture(entry.resourceType, captureAll)) return;

    const record = {
      requestId: entry.requestId,
      tabId: entry.tabId,
      frameId: entry.frameId,
      url: entry.url,
      method: entry.method,
      resourceType: entry.resourceType,
      queryParams: entry.queryParams,
      requestHeaders: entry.requestHeaders,
      postData: entry.postData,
      status: entry.status,
      responseHeaders: entry.responseHeaders,
      responseBody: entry.responseBody,
      bodyTruncated: entry.bodyTruncated,
      // Set-Cookie 去重（redirectResponse 与 extraInfo 可能携带相同值）
      setCookies: Array.from(new Set(entry.setCookies || [])),
      // 重定向标记与跳转目标（非重定向记录为 false / 空）
      isRedirect: !!entry.isRedirect,
      redirectTo: entry.redirectTo || "",
      timestamp: nowBeijingISO(),
    };

    try {
      const id = await this._dataStore.save(record);
      record.id = id;
      if (this._onRecord) this._onRecord(record);
    } catch (e) {
      // 存储失败由 service_worker 统一以中文提示，避免控制台报错
      void e;
    }
  }

  /** 不区分大小写读取响应头中的某个值 */
  _headerValue(headers, name) {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers || {})) {
      if (k.toLowerCase() === lower) return v;
    }
    return "";
  }
}
