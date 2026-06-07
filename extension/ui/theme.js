/**
 * ui/theme.js
 * 主题管理：定义多套主题配色、应用主题（写入 CSS 变量）、持久化与读取。
 * 遵循规范第 26 条（支持主题颜色修改）。所有界面共用，避免重复实现（规范第 36 条）。
 */

import { STORAGE_KEYS } from "../common/constants.js";

/**
 * 主题定义列表。
 * 每个主题包含：唯一 key、中文名称 label、是否暗色 dark，
 * 以及一组配色变量（强调色、强调色渐变、点缀色）。
 * 明暗基底由 dark 决定，具体底色在 CSS 中按 [data-dark] 切换。
 */
export const THEMES = [
  {
    key: "aurora",
    label: "极光蓝",
    dark: true,
    vars: {
      "--accent": "#3b82f6",
      "--accent-2": "#22d3ee",
      "--accent-rgb": "59, 130, 246",
      "--glow": "rgba(59, 130, 246, 0.45)",
    },
  },
  {
    key: "nebula",
    label: "星云紫",
    dark: true,
    vars: {
      "--accent": "#8b5cf6",
      "--accent-2": "#ec4899",
      "--accent-rgb": "139, 92, 246",
      "--glow": "rgba(139, 92, 246, 0.45)",
    },
  },
  {
    key: "emerald",
    label: "翡翠绿",
    dark: true,
    vars: {
      "--accent": "#10b981",
      "--accent-2": "#84cc16",
      "--accent-rgb": "16, 185, 129",
      "--glow": "rgba(16, 185, 129, 0.4)",
    },
  },
  {
    key: "sunset",
    label: "落日橙",
    dark: true,
    vars: {
      "--accent": "#f97316",
      "--accent-2": "#f43f5e",
      "--accent-rgb": "249, 115, 22",
      "--glow": "rgba(249, 115, 22, 0.42)",
    },
  },
  {
    key: "daylight",
    label: "晴空白",
    dark: false,
    vars: {
      "--accent": "#2563eb",
      "--accent-2": "#0ea5e9",
      "--accent-rgb": "37, 99, 235",
      "--glow": "rgba(37, 99, 235, 0.3)",
    },
  },
];

// 默认主题 key
export const DEFAULT_THEME = "aurora";

/**
 * 应用主题到当前文档：设置明暗标记与各 CSS 变量。
 * @param {string} key 主题 key
 */
export function applyTheme(key) {
  const theme = THEMES.find((t) => t.key === key) || THEMES.find((t) => t.key === DEFAULT_THEME);
  const root = document.documentElement;
  root.setAttribute("data-theme", theme.key);
  root.setAttribute("data-dark", theme.dark ? "1" : "0");
  for (const [name, value] of Object.entries(theme.vars)) {
    root.style.setProperty(name, value);
  }
}

/**
 * 从存储读取已保存主题并应用；无则用默认主题。
 * @returns {Promise<string>} 当前主题 key
 */
export async function initTheme() {
  let key = DEFAULT_THEME;
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.THEME);
    if (data && data[STORAGE_KEYS.THEME]) key = data[STORAGE_KEYS.THEME];
  } catch (e) {
    void e; // 存储不可用时回退默认主题
  }
  applyTheme(key);
  return key;
}

/**
 * 切换并持久化主题。
 * @param {string} key 主题 key
 */
export async function setTheme(key) {
  applyTheme(key);
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.THEME]: key });
  } catch (e) {
    void e;
  }
}

/**
 * 监听主题在其他页面被切换，实时同步到当前页面。
 * @param {(key:string)=>void} [onChange] 主题变化回调（用于刷新选择器选中态）
 */
export function watchThemeChange(onChange) {
  if (!chrome.storage || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const c = changes[STORAGE_KEYS.THEME];
    if (c && c.newValue) {
      applyTheme(c.newValue);
      if (onChange) onChange(c.newValue);
    }
  });
}
