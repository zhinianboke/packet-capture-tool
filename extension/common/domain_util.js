/**
 * common/domain_util.js
 * 主域名解析工具：从网址派生用于注入 Cookie 的主域名。
 */

/**
 * 从网址派生主域名。
 * 需求 5.4：如 www.goofish.com -> .goofish.com。
 * 采用“末两段”简化策略以匹配参考实现（.goofish.com、.taobao.com）；
 * 主机段数 ≤2 时返回 “.” + 主机名，否则取末两段并加前导点。
 * 对多级公共后缀（如 .com.cn）可在后续迭代引入公共后缀列表增强。
 * @param {string} url 用户输入的网址
 * @returns {string} 以点号开头的主域名
 */
export function deriveMainDomain(url) {
  const host = new URL(url).hostname; // 取主机名
  const parts = host.split(".");
  if (parts.length <= 2) return "." + host; // 已是注册域或单段主机
  return "." + parts.slice(-2).join("."); // 取末两段并加前导点
}
