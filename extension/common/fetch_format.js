/**
 * common/fetch_format.js
 * 将请求记录转换为可直接运行的 fetch 代码字符串（类似 Chrome DevTools 的 Copy as fetch）。
 * 纯函数，便于测试与复用。
 */

// 不允许携带请求体的方法（fetch 规范：GET/HEAD 不能有 body）
const BODYLESS_METHODS = ["GET", "HEAD"];

/**
 * 将一条请求记录转换为 fetch 代码。
 * URL 直接使用记录中的完整 URL（已含查询参数）；请求头取已采集的完整头（含 Cookie）；
 * 允许带体的方法且有请求体时附带 body；统一加 credentials: "include" 以便携带登录态重放。
 * @param {object} record 请求记录（含 url、method、requestHeaders、postData）
 * @returns {string} fetch 代码字符串
 */
export function toFetchCode(record) {
  if (!record) return "";
  const method = String(record.method || "GET").toUpperCase();
  const url = record.url || "";

  // options 字段顺序：headers、（body）、method、credentials
  const options = {};
  options.headers = record.requestHeaders && typeof record.requestHeaders === "object"
    ? record.requestHeaders
    : {};
  if (!BODYLESS_METHODS.includes(method) && record.postData != null && record.postData !== "") {
    options.body = String(record.postData);
  }
  options.method = method;
  options.credentials = "include";

  // JSON.stringify 自动完成字符串转义，安全可靠
  return `fetch(${JSON.stringify(url)}, ${JSON.stringify(options, null, 2)});`;
}
