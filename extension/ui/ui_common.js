/**
 * ui/ui_common.js
 * 界面公共工具：与后台通信的封装、消息提示（showToast）、HTML 转义、遮罩控制。
 * 统一使用 showToast 而非 alert（规范第 6 条）。
 */

/**
 * 向后台发送指令并返回统一响应结构。
 * 带超时兜底：后台长时间无响应时也会 resolve，避免界面遮罩永久转圈。
 * @param {string} type 指令类型
 * @param {object} [payload] 附带数据
 * @param {number} [timeoutMs] 超时毫秒（默认 90 秒，遵循规范第 19 条）
 * @returns {Promise<{code:number,success:boolean,message:string,data:*}>}
 */
export function sendMessage(type, payload = {}, timeoutMs = 90000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => {
      finish({ code: 1, success: false, message: "操作超时，后台无响应", data: null });
    }, timeoutMs);
    chrome.runtime.sendMessage({ type, payload }, (res) => {
      // 后台未响应时给出统一失败结构，避免控制台报错
      if (chrome.runtime.lastError) {
        finish({ code: 1, success: false, message: chrome.runtime.lastError.message, data: null });
        return;
      }
      finish(res || { code: 1, success: false, message: "后台无响应", data: null });
    });
  });
}

/**
 * 显示消息提示（替代 alert，规范第 6 条）。
 * @param {string} message 提示文案
 * @param {"info"|"success"|"error"} [kind] 提示类型
 * @param {number} [duration] 显示时长（毫秒）
 */
export function showToast(message, kind = "info", duration = 2600) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast toast-${kind}`;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.hidden = true;
  }, duration);
}

/**
 * 将文本写入系统剪贴板。
 * 优先使用 navigator.clipboard，失败时回退到 execCommand（兼容性兜底）。
 * @param {string} text 待复制文本
 * @returns {Promise<boolean>} 是否复制成功
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    void e; // 回退到下方兜底方案
  }
  // 兜底：临时 textarea + execCommand
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const okFlag = document.execCommand("copy");
    document.body.removeChild(ta);
    return okFlag;
  } catch (e) {
    return false;
  }
}

/**
 * HTML 转义，防范 XSS（规范第 22 条）。
 * @param {*} value 任意值
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 显示/隐藏加载遮罩（规范第 23 条）。
 * @param {boolean} show 是否显示
 */
export function setLoading(show) {
  const mask = document.getElementById("loadingMask");
  if (mask) mask.hidden = !show;
}

/**
 * 渲染主题选择器（一组可点击的主题色点），两个页面共用。
 * 点击后应用并持久化主题，同时刷新选中态。
 * @param {string} containerId 容器元素 id
 * @param {Array<{key:string,label:string,vars:object}>} themes 主题列表
 * @param {string} currentKey 当前主题 key
 * @param {(key:string)=>void} onPick 选择回调
 */
export function renderThemeSwitch(containerId, themes, currentKey, onPick) {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.innerHTML = "";
  for (const theme of themes) {
    const dot = document.createElement("button");
    dot.className = "theme-dot" + (theme.key === currentKey ? " active" : "");
    dot.title = theme.label;
    dot.dataset.key = theme.key;
    // 用主题强调色渐变作为色点
    dot.style.background = `linear-gradient(135deg, ${theme.vars["--accent"]}, ${theme.vars["--accent-2"]})`;
    dot.addEventListener("click", () => {
      for (const d of box.querySelectorAll(".theme-dot")) {
        d.classList.toggle("active", d.dataset.key === theme.key);
      }
      onPick(theme.key);
    });
    box.appendChild(dot);
  }
}
