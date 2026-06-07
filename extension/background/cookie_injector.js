/**
 * background/cookie_injector.js
 * Cookie 注入器：解析 Cookie 字符串、派生注入载荷、并通过 chrome.cookies.set 注入。
 * 纯函数（parseCookies、buildCookiePayloads）便于属性测试；inject 负责实际注入。
 */

import { deriveMainDomain } from "../common/domain_util.js";

/**
 * 解析 "name=value; name2=value2" 形式的 Cookie 字符串为名称-值映射。
 * 需求 5.3：以 ; 分割并取首个 = 拆分；名称与值各自去除首尾空白。
 * @param {string} cookieStr Cookie 字符串
 * @returns {Object<string,string>} 名称到值的映射
 */
export function parseCookies(cookieStr) {
  const result = {};
  if (!cookieStr) return result;
  for (const item of cookieStr.split(";")) {
    const trimmed = item.trim();
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
  return result;
}

/**
 * 将 Cookie 条目序列化为 "name=value; name2=value2" 形式的字符串。
 * 与 parseCookies 对称，便于一键复制（规范第 52 条：复用共通逻辑）。
 * @param {Array<{name:string,value:string}>} cookies Cookie 条目数组（如 chrome.cookies.getAll 结果）
 * @returns {string} 拼接后的 Cookie 字符串
 */
export function serializeCookies(cookies) {
  if (!Array.isArray(cookies)) return "";
  return cookies
    .filter((c) => c && c.name)
    .map((c) => `${c.name}=${c.value == null ? "" : c.value}`)
    .join("; ");
}

/**
 * 对 Cookie 条目与域名做笛卡尔积，生成注入载荷数组。
 * 需求 5.5：每个域名都包含全部名称-值条目。
 * @param {Object<string,string>} cookies 名称-值映射
 * @param {string[]} domains 目标域名列表
 * @returns {Array<{name:string,value:string,domain:string,path:string}>}
 */
export function buildCookiePayloads(cookies, domains) {
  const payloads = [];
  for (const [name, value] of Object.entries(cookies)) {
    for (const domain of domains) {
      payloads.push({ name, value, domain, path: "/" });
    }
  }
  return payloads;
}

/**
 * 执行 Cookie 注入。
 * 需求 5.3/5.4/5.5：解析 Cookie，组合主域名与附加域名，逐条调用 chrome.cookies.set。
 * 单条注入失败时记录失败项并继续，不中断其余注入（错误处理表 5.4/5.5）。
 * @param {string} cookieStr Cookie 字符串
 * @param {string} url 目标网址（用于派生主域名）
 * @param {string[]} extraDomains 附加目标域名
 * @returns {Promise<{success:boolean, total:number, failed:Array<{payload:object,error:string}>}>}
 */
export async function inject(cookieStr, url, extraDomains = []) {
  const cookies = parseCookies(cookieStr);
  const domains = [deriveMainDomain(url), ...extraDomains];
  const payloads = buildCookiePayloads(cookies, domains);
  const failed = [];

  for (const p of payloads) {
    // 去掉前导点用于构造 url 字段（chrome.cookies.set 需要 url）
    const bareDomain = p.domain.replace(/^\./, "");
    try {
      await chrome.cookies.set({
        url: "https://" + bareDomain + p.path,
        name: p.name,
        value: p.value,
        domain: p.domain,
        path: p.path,
      });
    } catch (e) {
      failed.push({ payload: p, error: String(e && e.message ? e.message : e) });
    }
  }

  return { success: failed.length === 0, total: payloads.length, failed };
}
