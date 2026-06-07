# 接口抓取工具（Chrome 扩展）

一款纯前端的 Chrome（Manifest V3）浏览器扩展，用于抓取当前浏览器中所有页面的网络请求，完整捕获请求与响应数据，提供炫酷的中文界面查看、筛选、导出，支持「右键复制为 fetch」「一键注入 Cookie 进入」与「一键复制当前页面 Cookie」。所有数据保存在本地 IndexedDB，不依赖任何后端服务。

> 本扩展基于 `chrome.debugger`（Chrome DevTools Protocol，简称 CDP）实现，是 MV3 下唯一能完整读取**响应体**与原始 **Set-Cookie** 的方案。

---

## ✨ 功能特性

| 能力 | 说明 |
| --- | --- |
| 全量请求抓取 | 捕获 URL、请求方法、请求头、请求参数（含大体积 POST body）、资源类型 |
| 完整响应采集 | 状态码、响应头、响应体（JSON/文本）、原始 Set-Cookie |
| 覆盖所有标签页与 iframe | 附加全部已打开标签页，自动附加新标签页与页面内嵌 iframe |
| 静态资源过滤 | 默认丢弃 图片 / 字体 / 样式 / 媒体 / JS，聚焦接口请求；可一键「捕获全部」 |
| 实时列表 | 监听中通过长连接实时刷新，**最新记录显示在最上面**，每行带时间（时:分:秒） |
| 类 Chrome Network 筛选 | 按类型（Fetch/XHR、文档、JS、CSS、字体、图片、媒体、WS、其他）+ URL 关键字筛选 |
| 重定向链抓取 | 30x 重定向的每一跳单独成记录，保留中间响应的状态码、响应头与 Set-Cookie |
| 详情查看 | 请求头、查询参数、请求体参数、响应头、响应体、Set-Cookie 分块展示 |
| 右键复制 | 右键列表记录，可「复制为 fetch」（可直接运行的 fetch 代码）、复制 URL、复制响应体 |
| 导出 | 导出全部记录为 JSON（完整保真）或 CSV（扁平化，Excel 友好，含 UTF-8 BOM）|
| 一键进入 | 输入网址 + Cookie，自动注入 Cookie 并在新标签页打开目标站点 |
| 一键复制 Cookie | 自动读取当前页面全部 Cookie，序列化后复制到剪贴板 |
| 本地存储 | IndexedDB 持久化，重开界面恢复历史记录，支持清空 |
| 多主题切换 | 内置 5 套主题（极光蓝 / 星云紫 / 翡翠绿 / 落日橙 / 晴空白），玻璃拟态科技风，持久化并跨页同步 |

界面全中文，自适应手机端，提供加载遮罩与消息提示。

---

## 🚀 安装与使用

### 加载扩展

1. 打开 Chrome，进入 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本仓库的 **`extension/`** 目录

### 基本流程

1. 点击工具栏的扩展图标打开弹窗，点击「开始监听」
2. 监听开启后，页面顶部会出现「扩展已开始调试此浏览器」的黄色横幅 —— **这是正常现象**，停止监听后自动消失（见下方「技术权衡」）
3. 点击「打开监控页」进入独立监控页面，查看实时请求列表、筛选、查看详情
4. 在列表中**右键**任意记录，可「复制为 fetch」「复制 URL」「复制响应体」
5. 用「导出 JSON / 导出 CSV」保存数据；「清空」清除本地记录

### 一键进入（带登录态访问）

在监控页顶部表单填写：

- **网址**：如 `https://www.goofish.com/`
- **Cookie 字符串**：如 `a=1; b=2; c=3`
- **附加域名**（可选，逗号分隔）：如 `.taobao.com`

点击「进入」后，扩展会解析 Cookie，注入到目标主域名（及附加域名），并在新标签页打开网址。若此时正在监听，新标签页会被自动附加并开始抓取。

### 一键复制当前页面 Cookie

点击「复制当前页面 Cookie」，扩展会读取当前网页标签页的全部 Cookie，拼接为 `name=value; ...` 字符串复制到剪贴板，并自动回填到 Cookie 输入框，方便直接用于「一键进入」。

---

## 🧠 工作原理

### 为什么用 chrome.debugger（CDP）

MV3 的 `chrome.webRequest` **无法读取响应体**，而本工具核心需求是采集响应体与原始 Set-Cookie。只有 CDP 的 `Network.getResponseBody` 能满足，因此选择 `chrome.debugger` 附加标签页并启用 `Network` 域。

### 技术权衡：调试器横幅

附加 `chrome.debugger` 后，Chrome 会在页面顶部显示黄色调试横幅，且与同标签页的 DevTools 互斥。这是为换取完整请求/响应采集能力付出的代价。停止监听时调用 `chrome.debugger.detach` 即可移除横幅。

### 请求生命周期（CDP 事件时序）

```
requestWillBeSent        → 建立 pending 记录（URL/方法/请求头/postData/资源类型）
                           └ 此处即按「捕获全部」开关 + 资源类型提前过滤，静态资源直接丢弃
responseReceivedExtraInfo → 解析原始 set-cookie（未经浏览器过滤）
responseReceived         → 合并 状态码 / 响应头 / MIME
loadingFinished          → 必要时补取大体积 POST body（getRequestPostData）
                           → 命中 json/text 时取响应体（getResponseBody）
                           → 仅 HTML 响应体做截断（上限 10000 字符）
                           → 组装记录 → 存入 IndexedDB → 实时推送界面
loadingFailed            → 以空响应体组装记录并保存
```

iframe 覆盖：附加标签页后执行 `Target.setAutoAttach`，子框架在 `Target.attachedToTarget` 中再次 `Network.enable`，从而采集 iframe 内的请求。

### 进程模型

- **后台 service worker**：MV3 下事件驱动、可被回收。监听状态与「捕获全部」开关写入 `chrome.storage.local`，worker 重启后自动恢复并重新附加；使用 `chrome.alarms` 心跳保活。
- **界面 ↔ 后台**：界面用 `chrome.runtime.sendMessage` 发指令（统一响应结构 `{ code, success, message, data }`），用 `chrome.runtime.connect` 长连接端口订阅「新增记录」「附加失败」「状态变化」事件实现实时刷新。

---

## 🏗️ 架构

```
┌──────────────────────────────────────────────────────────────┐
│                     监控界面 (ui/)                             │
│  popup.html/js（快捷操作）· monitor.html/js（列表+详情+表单）   │
│  styles.css（主题样式）· theme.js（主题）· ui_common.js（通用） │
└───────────────▲─────────────────────────────┬────────────────┘
        sendMessage 指令                  connect 端口订阅事件
                │                               │
┌───────────────┴─────────────────────────────▼────────────────┐
│            后台服务工作线程 service_worker.js                   │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ 捕获引擎    │ │ Cookie 注入器 │ │ 导出模块      │             │
│  │capture_    │ │cookie_       │ │export_       │             │
│  │engine(CDP) │ │injector      │ │module        │             │
│  └─────┬──────┘ └──────┬───────┘ └──────┬───────┘             │
│        │ cdp_session    │ chrome.cookies  │                    │
│        ▼                ▼                 ▼                    │
│  ┌──────────────────────────────────────────────┐            │
│  │           数据存储 data_store (IndexedDB)       │            │
│  └──────────────────────────────────────────────┘            │
└───────────────────────────────────────────────────────────────┘
        │ chrome.debugger (CDP)
        ▼
   目标标签页 + iframe
```

---

## 📁 目录结构

```
packet-capture-tool/
├── extension/                     # 扩展本体（加载此目录）
│   ├── manifest.json              # MV3 清单
│   ├── _locales/zh_CN/            # 中文 locale
│   ├── background/                # 后台逻辑
│   │   ├── service_worker.js      # 后台入口：消息路由、生命周期、保活
│   │   ├── capture_engine.js      # CDP 附加与请求/响应采集、提前过滤、记录组装
│   │   ├── cdp_session.js         # chrome.debugger 命令/事件的 Promise 封装
│   │   ├── cookie_injector.js     # Cookie 解析 / 序列化 / 注入
│   │   ├── export_module.js       # JSON / CSV 导出
│   │   └── data_store.js          # IndexedDB 封装（save/getAll/clear）
│   ├── common/                    # 前后台共用纯模块
│   │   ├── constants.js           # 常量：资源类型、截断阈值、消息类型、筛选分组、存储键
│   │   ├── filters.js             # 过滤、响应体判定/截断、列表筛选（纯函数）
│   │   ├── domain_util.js         # 主域名派生
│   │   ├── url_util.js            # URL 查询参数解析
│   │   ├── fetch_format.js        # 请求记录转 fetch 代码（复制为 fetch）
│   │   └── time_util.js           # 北京时间（UTC+8）时间戳
│   └── ui/                        # 界面
│       ├── popup.html / popup.js  # 弹窗（快捷操作）
│       ├── monitor.html / monitor.js  # 独立监控页（列表+详情+筛选+右键菜单+表单）
│       ├── styles.css             # 主题样式（玻璃拟态科技风）
│       ├── theme.js               # 多主题定义、应用、持久化、跨页同步
│       └── ui_common.js           # 通用：消息、提示、转义、剪贴板、遮罩、主题选择器
├── test_browser_monitor.py        # 参考实现（Playwright 版，本扩展据此重构）
├── .gitignore
└── README.md
```

---

## 🧩 核心模块说明

- **capture_engine.js** — 抓取核心。管理 CDP 附加（含 iframe 自动附加）、URL 可附加性过滤、并发附加去重、CDP 事件解析、请求头/响应头合并、重定向链定稿、记录组装与持久化。
- **cdp_session.js** — 把 `chrome.debugger` 的回调式 API 封装为 Promise，统一错误处理，避免控制台抛未捕获异常。
- **cookie_injector.js** — `parseCookies` 解析、`serializeCookies` 序列化、`buildCookiePayloads` 生成注入载荷、`inject` 调用 `chrome.cookies.set` 注入。
- **filters.js** — `shouldCapture`（静态资源过滤）、`shouldCaptureBody`（按 content-type 判定是否取响应体）、`isHtmlContentType`（仅 HTML 截断）、`truncateBody`（截断）、`matchesTypeGroup`/`matchesFilter`（列表筛选）。
- **url_util.js** — `parseQueryParams` 从 URL 解析查询参数。
- **fetch_format.js** — `toFetchCode` 将请求记录转为可运行的 fetch 代码（复制为 fetch）。
- **data_store.js** — IndexedDB 封装，对象存储 `requests`（自增主键）。
- **export_module.js** — `exportJSON` 完整保真序列化；`exportCSV` 扁平化为表格（中文表头、复杂字段 JSON 化、标准 CSV 转义）。
- **theme.js / ui_common.js** — 主题与界面通用能力，多页面复用。

---

## 🗃️ 数据模型（Request_Record）

每条请求记录的主要字段：

| 字段 | 含义 |
| --- | --- |
| `id` | IndexedDB 自增主键 |
| `requestId` / `tabId` / `frameId` | CDP 请求 ID、来源标签页、来源框架 |
| `url` / `method` / `resourceType` | 请求 URL、方法、资源类型 |
| `queryParams` | URL 查询参数（名-值数组），与 postData 共同构成完整请求参数 |
| `requestHeaders` / `postData` | 请求头（含 Cookie，合并自 extraInfo）、请求体参数 |
| `status` / `responseHeaders` | 响应状态码、响应头（合并 responseReceived 与原始 extraInfo 头） |
| `responseBody` / `bodyTruncated` | 响应体文本（可能为 null）、是否被截断 |
| `isRedirect` / `redirectTo` | 是否为重定向（30x）中间记录、重定向跳转目标 URL |
| `setCookies` | 原始 Set-Cookie 字符串数组（含重定向跳转下发的 Cookie） |
| `timestamp` | 北京时间（Asia/Shanghai，UTC+8）ISO 字符串 |

---

## ⚠️ 注意事项

- **调试横幅**：监听期间黄色横幅属正常现象；同一标签页无法同时打开 DevTools。
- **过滤生效时机**：静态资源在采集阶段就被丢弃。修改过滤规则后，**库里的历史旧记录不会自动消失**，点「清空」重抓即可获得干净数据。
- **响应体截断**：仅 HTML 响应体在超过 10000 字符时截断；JSON、纯文本等保留完整内容。
- **列表显示上限**：监控页列表最多显示最新 2000 条，超出时移除界面上最老的行；**这只影响显示，后台 IndexedDB 仍全量保存，导出包含全部记录**。
- **主域名派生**：采用「末两段」简化策略（如 `www.goofish.com → .goofish.com`），多级公共后缀（如 `.com.cn`）可在后续迭代引入公共后缀列表增强。
- **数据隐私**：所有抓取数据仅保存在本地 IndexedDB，不上传任何服务器。请妥善保管导出文件与 Cookie 字符串，避免泄露登录态。

---

## 📌 权限说明

| 权限 | 用途 |
| --- | --- |
| `debugger` | 附加 CDP，采集响应体（核心） |
| `tabs` | 枚举/打开标签页、监听新标签页 |
| `cookies` | 读取与注入 Cookie |
| `storage` | 持久化开关、主题、监听状态 |
| `alarms` | service worker 保活心跳 |
| `host_permissions: <all_urls>` | 跨域读取/注入 Cookie、附加任意网页 |

---

## 📄 开源协议

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)** 开源，详见 [LICENSE](./LICENSE)。

要点：
- 你可以自由使用、修改和分发本软件；
- 任何分发的修改版本必须同样以 AGPL-3.0 开源；
- **若你将修改后的版本通过网络对外提供服务，也必须向用户公开对应的源代码**（AGPL 相较 GPL 的核心区别，见协议第 13 条）。
