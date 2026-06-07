/**
 * common/filters.js
 * 过滤与响应体处理纯函数集合：
 * - shouldCapture：根据“捕获全部”开关与资源类型判断是否保留该请求；
 * - shouldCaptureBody：根据 content-type 判断是否采集响应体文本；
 * - truncateBody：对超长响应体进行截断。
 * 这些函数均为纯函数，便于属性测试。
 */

import { STATIC_TYPES, MAX_BODY_LEN, TRUNCATE_MARK, FILTER_GROUPS, KNOWN_FILTER_TYPES } from "./constants.js";

/**
 * 判断某请求是否应被采集。
 * 需求 6.2/6.3：捕获全部开启时保留全部；关闭时丢弃静态资源类型。
 * 注意：CDP（chrome.debugger）的资源类型为大写驼峰（如 Stylesheet、Image、Font、Media），
 * 而 STATIC_TYPES 为小写，故此处做大小写不敏感比较，保证过滤生效。
 * @param {string} resourceType 资源类型（如 Image、Stylesheet、XHR、Document）
 * @param {boolean} captureAll “捕获全部”开关状态
 * @returns {boolean} true 表示保留采集，false 表示丢弃
 */
export function shouldCapture(resourceType, captureAll) {
  if (captureAll) return true;
  const type = (resourceType || "").toLowerCase();
  return !STATIC_TYPES.includes(type);
}

/**
 * 判断是否应采集响应体文本。
 * 需求 1.3：content-type（不区分大小写）包含 json 或 text 时采集。
 * @param {string} contentType 响应的 content-type 头
 * @returns {boolean}
 */
export function shouldCaptureBody(contentType) {
  const ct = (contentType || "").toLowerCase();
  return ct.includes("json") || ct.includes("text");
}

/**
 * 判断 content-type 是否为 HTML 类型。
 * 仅当响应体为 HTML 时才需要截断处理（其余类型如 JSON、纯文本保留完整内容）。
 * @param {string} contentType 响应的 content-type 头
 * @returns {boolean}
 */
export function isHtmlContentType(contentType) {
  return (contentType || "").toLowerCase().includes("html");
}

/**
 * 截断超长响应体文本。
 * 需求 1.4：超过 MAX_BODY_LEN 时截断至该长度并追加截断标记，否则原样返回。
 * 对 null/undefined 原样返回。
 * @param {string|null|undefined} text 响应体文本
 * @returns {string|null|undefined}
 */
export function truncateBody(text) {
  if (text == null) return text;
  if (text.length > MAX_BODY_LEN) {
    return text.slice(0, MAX_BODY_LEN) + TRUNCATE_MARK;
  }
  return text;
}

/**
 * 判断某资源类型是否属于指定筛选分组。
 * 类似 Chrome Network 的类型筛选；分组定义见 constants.js 的 FILTER_GROUPS。
 * @param {string} resourceType 记录的资源类型（CDP 大写驼峰，如 Stylesheet）
 * @param {string} groupKey 分组标识（如 all、xhr、js、other）
 * @returns {boolean} 是否匹配
 */
export function matchesTypeGroup(resourceType, groupKey) {
  if (!groupKey || groupKey === "all") return true;
  const type = (resourceType || "").toLowerCase();
  const group = FILTER_GROUPS.find((g) => g.key === groupKey);
  if (!group) return true;
  // “其他”分组：兜底匹配所有未被其它分组明确归类的类型
  if (group.key === "other") {
    return !KNOWN_FILTER_TYPES.has(type);
  }
  return group.types.includes(type);
}

/**
 * 判断某记录是否匹配筛选条件（类型分组 + URL 关键字，大小写不敏感）。
 * 用于界面客户端筛选，纯函数便于测试。
 * @param {object} record 请求记录（含 resourceType、url）
 * @param {string} groupKey 类型分组标识
 * @param {string} keyword URL 关键字（为空表示不按关键字过滤）
 * @returns {boolean} 是否应展示该记录
 */
export function matchesFilter(record, groupKey, keyword) {
  if (!record) return false;
  if (!matchesTypeGroup(record.resourceType, groupKey)) return false;
  const kw = (keyword || "").trim().toLowerCase();
  if (kw && !String(record.url || "").toLowerCase().includes(kw)) return false;
  return true;
}
