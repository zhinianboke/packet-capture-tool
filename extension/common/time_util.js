/**
 * common/time_util.js
 * 时间工具：统一生成北京时间（Asia/Shanghai，UTC+8）的 ISO 字符串。
 * 遵循规范第 17 条，全链路使用北京时间。
 */

/**
 * 返回当前北京时间的 ISO 字符串，形如 2026-06-04T12:34:56.789+08:00。
 * 做法：在 UTC 毫秒上加 8 小时得到北京墙钟时间，再以 +08:00 标注时区。
 * @returns {string}
 */
export function nowBeijingISO() {
  const beijingMs = Date.now() + 8 * 60 * 60 * 1000;
  // toISOString 输出 UTC 标记 Z，此处墙钟已是北京时间，替换为 +08:00 标注
  return new Date(beijingMs).toISOString().replace("Z", "+08:00");
}
