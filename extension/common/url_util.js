/**
 * common/url_util.js
 * URL 工具：从请求 URL 中解析查询参数（query string），用于完整展示请求参数。
 */

/**
 * 解析 URL 中的查询参数为名称-值数组。
 * 支持同名参数重复出现（各自保留为一项），值自动解码。
 * @param {string} url 请求 URL
 * @returns {Array<{name:string, value:string}>} 查询参数数组；无参数或解析失败时返回空数组
 */
export function parseQueryParams(url) {
  if (!url) return [];
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return [];
  const query = url.slice(qIndex + 1).split("#")[0]; // 去掉 hash 片段
  if (!query) return [];
  const result = [];
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawName = eq >= 0 ? pair.slice(0, eq) : pair;
    const rawValue = eq >= 0 ? pair.slice(eq + 1) : "";
    result.push({ name: safeDecode(rawName), value: safeDecode(rawValue) });
  }
  return result;
}

/**
 * 安全地对 URL 组件解码：解码失败（非法转义序列）时原样返回。
 * @param {string} s 待解码字符串
 * @returns {string}
 */
function safeDecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch (e) {
    return s;
  }
}
