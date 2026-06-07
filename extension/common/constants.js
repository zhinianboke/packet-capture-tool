/**
 * common/constants.js
 * 公共常量定义：静态资源类型、响应体截断阈值、消息类型等。
 * 供后台服务工作线程与界面共同使用，避免在各处重复定义。
 */

// 默认过滤的静态资源类型：在“捕获全部”关闭时丢弃这些类型，聚焦接口请求。
// 在需求 6.2（image/font/stylesheet/media）基础上，按使用诉求追加 script（JS 文件），
// 使默认视图只保留 XHR/Fetch/Document 等接口请求，不显示 JS 等静态资源。
export const STATIC_TYPES = ["image", "font", "stylesheet", "media", "script"];

/**
 * 列表筛选分组定义（类似 Chrome Network 的 All / Fetch/XHR / JS / CSS …）。
 * key 为分组标识，label 为中文标签，types 为该分组包含的 CDP 资源类型（统一小写比较）。
 * key 为 "all" 时表示不过滤；types 为空数组的分组（如 other）由“其余类型”兜底匹配。
 */
export const FILTER_GROUPS = [
  { key: "all", label: "全部", types: [] },
  { key: "xhr", label: "Fetch/XHR", types: ["xhr", "fetch"] },
  { key: "doc", label: "文档", types: ["document"] },
  { key: "js", label: "JS", types: ["script"] },
  { key: "css", label: "CSS", types: ["stylesheet"] },
  { key: "font", label: "字体", types: ["font"] },
  { key: "img", label: "图片", types: ["image"] },
  { key: "media", label: "媒体", types: ["media"] },
  { key: "ws", label: "WS", types: ["websocket"] },
  { key: "other", label: "其他", types: [] },
];

// 已被明确归类的资源类型集合，用于“其他”分组兜底匹配（不在此集合的归为其他）
export const KNOWN_FILTER_TYPES = FILTER_GROUPS.reduce((set, g) => {
  for (const t of g.types) set.add(t);
  return set;
}, new Set());

// 需求 1.4：单个响应体文本的最大保留长度（字符数），超出则截断
export const MAX_BODY_LEN = 10000;

// 需求 1.4：响应体被截断时追加的标记
export const TRUNCATE_MARK = "...(已截断)";

// IndexedDB 数据库名称与对象存储名称
export const DB_NAME = "request_monitor_db";
export const DB_VERSION = 1;
export const STORE_NAME = "requests";

// chrome.storage.local 中保存的配置键名
export const STORAGE_KEYS = {
  // 当前是否处于监听中（用于 worker 重启后恢复）
  MONITORING: "monitoring",
  // “捕获全部”开关状态（需求 6.4 持久化）
  CAPTURE_ALL: "captureAll",
  // 界面主题标识（规范第 26 条：支持主题颜色修改）
  THEME: "theme",
};

// service worker 保活心跳所用的 alarm 名称
export const KEEPALIVE_ALARM = "request_monitor_keepalive";

// 长连接端口名称（UI 订阅后台推送事件）
export const PORT_NAME = "request_monitor_port";

/**
 * 后台与界面之间的消息类型常量。
 * MSG：UI -> 后台的指令；EVENT：后台 -> UI 的推送事件。
 */
export const MSG = {
  START_MONITOR: "start_monitor", // 开始监听
  STOP_MONITOR: "stop_monitor", // 停止监听
  GET_STATUS: "get_status", // 查询监听状态与开关
  GET_RECORDS: "get_records", // 读取全部已存请求记录
  CLEAR_RECORDS: "clear_records", // 清空全部请求记录
  EXPORT_JSON: "export_json", // 导出 JSON
  EXPORT_CSV: "export_csv", // 导出 CSV
  ENTER_ACTION: "enter_action", // 一键进入（网址 + Cookie）
  TOGGLE_CAPTURE_ALL: "toggle_capture_all", // 切换“捕获全部”开关
  COPY_COOKIES: "copy_cookies", // 一键复制当前标签页全部 Cookie
};

// 后台经长连接端口推送给界面的事件类型
export const EVENT = {
  NEW_RECORD: "new_record", // 新增一条请求记录
  ATTACH_FAILED: "attach_failed", // 某标签页附加失败
  STATUS_CHANGED: "status_changed", // 监听状态变化
};
