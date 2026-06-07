/**
 * background/export_module.js
 * 导出模块：将请求记录导出为 JSON 与 CSV 两种格式。
 * exportJSON 完整保留所有字段；exportCSV 将记录扁平化为表格，每条记录一行。
 */

// 需求 4.2：CSV 列定义（含关键列 url、method、status 与时间 timestamp）
export const CSV_COLUMNS = [
  "id",
  "timestamp",
  "method",
  "url",
  "status",
  "resourceType",
  "isRedirect",
  "redirectTo",
  "requestHeaders",
  "queryParams",
  "postData",
  "responseHeaders",
  "responseBody",
  "setCookies",
];

// CSV 中文表头映射（与 CSV_COLUMNS 一一对应），便于中文用户在 Excel 中阅读
export const CSV_HEADER_LABELS = {
  id: "序号",
  timestamp: "时间",
  method: "方法",
  url: "URL",
  status: "状态码",
  resourceType: "资源类型",
  isRedirect: "是否重定向",
  redirectTo: "重定向目标",
  requestHeaders: "请求头",
  queryParams: "查询参数",
  postData: "请求体参数",
  responseHeaders: "响应头",
  responseBody: "响应体",
  setCookies: "Set-Cookie",
};

/**
 * 导出为 JSON 字符串。
 * 需求 4.1/4.3：以缩进格式序列化记录数组，完整保留所有字段。
 * @param {object[]} records 请求记录数组
 * @returns {string} JSON 文本
 */
export function exportJSON(records) {
  return JSON.stringify(records, null, 2);
}

/**
 * 将复杂字段（对象/数组）序列化为字符串。
 * null/undefined 转为空串，其余基础类型转字符串。
 * @param {*} v 字段值
 * @returns {string}
 */
export function flattenField(v) {
  if (v == null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/**
 * CSV 字段转义：含逗号、引号或换行时用双引号包裹，内部引号翻倍。
 * @param {string} s 已扁平化的字段字符串
 * @returns {string}
 */
export function csvEscape(s) {
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 导出为 CSV 文本。
 * 需求 4.2/4.3：生成表头与每条记录一行的数据，字段经扁平化与转义，行间以 \r\n 分隔。
 * @param {object[]} records 请求记录数组
 * @returns {string} CSV 文本
 */
export function exportCSV(records) {
  // 表头使用中文标签（无映射则回退英文字段名）
  const header = CSV_COLUMNS.map((c) => csvEscape(CSV_HEADER_LABELS[c] || c)).join(",");
  const rows = records.map((r) =>
    CSV_COLUMNS.map((c) => csvEscape(flattenField(r[c]))).join(",")
  );
  return [header, ...rows].join("\r\n");
}
