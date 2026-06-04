# CODE-K — 代码交易所

> 把 Git 仓库当成股市来可视化：**每个文件是一支"股票"**，每次 commit 是一根 K 线，代码增删即涨跌。

![status](https://img.shields.io/badge/status-MVP-orange) ![node](https://img.shields.io/badge/node-%E2%89%A520-339933) ![react](https://img.shields.io/badge/react-19-61dafb) ![electron](https://img.shields.io/badge/electron-42-47848F)

---

## 特性

- **文件即股票** — 仓库内每个文件都有独立行情：当前行数、最新涨跌、累计成交量、迷你走势
- **Commit 即 K 线** — 每次提交产生一根蜡烛（OHLC = 当时的代码行数变化）
- **IPO / 退市机制** — 新文件首次出现 = 新股上市；行数归零 = 退市
- **大盘指数** — Dashboard 页面展示仓库级综合指数、板块统计、涨跌幅排行
- **仓库自动发现** — 扫描 `~/Desktop`、`~/Documents`、`D:\codeFile` 等常见目录
- **双解析模式** — 后端 WebSocket 实时解析 + 前端 `isomorphic-git` 本地解析（无需后端）
- **缓存加速** — 服务端文件缓存 + 前端 IndexedDB 缓存，重复打开秒加载
- **文件监视** — 后端 `watcher.js` 轮询 HEAD 变更，有新 commit 自动增量解析
- **实时解析进度** — WebSocket 推送 `progress` / `partial` / `complete` 三阶段
- **完整图表** — 蜡烛图（lightweight-charts）+ 迷你走势图 + 红绿 diff 对比
- **虚拟列表** — `react-window` 大列表高性能渲染
- **多仓库 Tab** — 同时打开多个仓库，标签页切换
- **键盘快捷键** — `Ctrl+K` 搜索、`G H` 首页、`G M` 行情、`?` 查看全部快捷键
- **桌面应用** — Electron 打包为 Windows Portable 独立可执行文件
- **赛博金融终端 UI** — Tailwind v4 + JetBrains Mono / Orbitron 字体

---

## 技术栈

| 层级 | 选型 |
|------|------|
| 前端 | React 19 · TypeScript 6 · Vite 8 · Tailwind CSS v4 |
| 路由 | react-router-dom v7 |
| 图表 | lightweight-charts v5 · 自定义 SparklineChart |
| 列表 | react-window（虚拟滚动）|
| 后端 | Node.js · `ws`（WebSocket）· 原生 `child_process` 调 `git` |
| 前端 Git | isomorphic-git（本地解析模式，无需后端）|
| 缓存 | 服务端文件缓存 · 前端 IndexedDB |
| 桌面 | Electron 42 · electron-builder（Portable）|
| 测试 | Vitest |
| 状态 | React Context + useReducer |

---

## 快速开始

### 环境要求

- Node.js ≥ 20
- Git 命令行工具在 `PATH` 中（后端解析模式）
- 浏览器需支持 `showDirectoryPicker`（Chrome / Edge 完整支持，用于前端本地解析）

### 安装与启动

```bash
# 安装依赖
npm install

# 一键启动（前端 5173 + 后端 3001）
npm run dev:all

# 或分别启动
npm run server   # Node 后端，端口 3001
npm run dev      # Vite 前端，端口 5173
```

打开 http://localhost:5173 ，选择本地 Git 仓库即可开始。

### Electron 桌面应用

```bash
# 开发模式（自动构建 Electron 代码 + 启动 Vite + 启动 Electron）
npm run electron:dev

# 打包为 Portable 可执行文件
npm run electron:build
```

打包产物位于 `release/` 目录。

---

## 使用流程

1. **首页（Home）** — 选择文件夹或手动输入路径，自动验证是否为 Git 仓库
2. **大盘（Dashboard）** — 查看仓库综合指数走势、板块分布、涨跌幅 / 成交量排行
3. **行情页（Market）** — 查看所有"股票"列表，可按市值 / 涨跌 / 成交量 / 交易数排序，按状态筛选
4. **股票详情（StockDetail）** — 点击任意文件查看 K 线图、提交历史，点击具体 commit 可查看红绿 diff

---

## 架构

```
┌────────────┐  HTTP /api/*           ┌──────────────────────┐
│  Home      │ ────────────────────→  │  server/index.js     │
│  Dashboard │                        │  ├─ routes/          │
│  Market    │  WebSocket             │  │  ├─ discover.js    │
│  Detail    │ ←── progress ───────   │  │  ├─ repo.js        │
│            │ ←── partial  ──────   │  │  └─ diff.js        │
│            │ ←── complete ──────   │  ├─ services/         │
│            │                        │  │  ├─ parser.js      │
│  (可选)    │  isomorphic-git        │  │  ├─ scanner.js     │
│  前端本地  │ ── 前端直接读取 ──→    │  │  └─ cache.js       │
│  解析模式  │  FileSystemHandle      │  ├─ lib/kline-core.js│
│            │                        │  ├─ ws-handler.js    │
│            │                        │  └─ watcher.js       │
└────────────┘                        └──────────────────────┘
     ↑                                         │
     └──── dev: 5173 ←── Vite proxy /api ──────┘
```

### 解析模式

| 模式 | 触发条件 | 说明 |
|------|---------|------|
| 后端解析 | 手动输入绝对路径 | 通过 WebSocket 调用服务端 `git` 命令，支持缓存和文件监视 |
| 前端本地解析 | 使用文件夹选择器 (`showDirectoryPicker`) | 使用 `isomorphic-git` + Web Worker 在浏览器内完成，无需后端 |

### K 线生成规则

对每个文件，沿 commit 时间线维护一个"行数计数器"：

- 第一次出现该文件 → **IPO**（开盘 0，收盘 = 增 − 删）
- 后续 commit → 开盘 = 上次收盘，收盘 = 开盘 + (增 − 删)
- 收盘归零且有删除 → **退市**
- 成交量 = 该 commit 的增 + 删

实现见 [server/services/parser.js](./server/services/parser.js) `buildFileStocks()` 和 [server/lib/kline-core.js](./server/lib/kline-core.js)。

---

## 目录结构

```
.
├── electron/
│   ├── main.ts               # Electron 主进程（窗口管理、IPC、后端进程）
│   ├── preload.ts             # 预加载脚本（安全 IPC 桥接）
│   └── updater.ts             # 自动更新逻辑
├── server/
│   ├── index.js               # HTTP 服务器入口（路由分发）
│   ├── ws-handler.js          # WebSocket 消息路由与解析任务编排
│   ├── watcher.js             # 文件监视（轮询 HEAD 变更）
│   ├── git-utils.js           # git 命令封装
│   ├── routes/
│   │   ├── discover.js        # /api/discover、/api/resolve
│   │   ├── repo.js            # /api/log、/api/diff
│   │   └── diff.js            # WebSocket diff 请求处理
│   ├── services/
│   │   ├── parser.js          # buildFileStocks()、getCommitsWithDiff()
│   │   ├── scanner.js         # 目录扫描（发现 Git 仓库）
│   │   └── cache.js           # 服务端文件缓存读写
│   └── lib/
│       └── kline-core.js      # K 线核心算法（前后端共享逻辑）
├── src/
│   ├── components/
│   │   ├── Layout.tsx         # 全局布局框架
│   │   ├── KlineChart.tsx     # 蜡烛图（lightweight-charts）
│   │   ├── SparklineChart.tsx # 迷你走势 SVG 图
│   │   ├── DiffViewer.tsx     # 红绿 diff 对比
│   │   ├── FileTree.tsx       # 文件树导航
│   │   ├── VirtualStockList.tsx # 虚拟滚动股票列表（react-window）
│   │   ├── MarketIndexChart.tsx # 大盘指数图
│   │   ├── MarketStats.tsx    # 市场统计数据
│   │   ├── TopMovers.tsx      # 涨跌幅排行
│   │   ├── RepoTabs.tsx       # 多仓库标签页
│   │   ├── ShortcutsHelp.tsx  # 快捷键帮助浮层
│   │   ├── Skeleton.tsx       # 骨架屏加载态
│   │   └── ErrorBoundary.tsx  # 错误边界
│   ├── pages/
│   │   ├── Home.tsx           # 首页（仓库选择）
│   │   ├── Dashboard.tsx      # 大盘（综合指数 + 板块统计）
│   │   ├── Market.tsx         # 行情页（股票列表）
│   │   └── StockDetail.tsx    # 股票详情（K 线 + 提交历史）
│   ├── hooks/
│   │   ├── useAppContext.ts   # Context 消费 hook
│   │   ├── useRepo.ts         # 仓库管理（多仓库、标签页）
│   │   ├── useWebSocket.ts    # WebSocket 连接与消息处理
│   │   ├── useLocalParser.ts  # 前端本地解析（isomorphic-git）
│   │   ├── useMarketIndex.ts  # 大盘指数计算
│   │   └── useShortcuts.ts    # 键盘快捷键
│   ├── context/
│   │   └── AppContext.tsx     # 全局状态（Context + Reducer）
│   ├── lib/
│   │   ├── types.ts           # TypeScript 类型定义
│   │   ├── kline-core.ts      # K 线核心算法（前端版）
│   │   ├── kline-data.ts      # buildFileStocks（前端版，本地解析用）
│   │   ├── git-core.ts        # isomorphic-git 封装
│   │   ├── git-parser.ts      # 前端 git 解析器
│   │   ├── git-worker.ts      # Web Worker（git 解析不阻塞 UI）
│   │   ├── cache.ts           # IndexedDB 缓存
│   │   └── export.ts          # 数据导出
│   ├── utils/
│   │   └── format.ts          # 数字 / 日期格式化
│   ├── polyfills.ts           # Buffer polyfill
│   ├── App.tsx / main.tsx
│   └── index.css              # Tailwind v4 + ex-* design tokens
├── scripts/
│   ├── build-electron.js      # Electron 构建脚本
│   └── gen-ico.js             # 图标生成
├── public/                    # 静态资源（favicon）
├── vite.config.ts             # Vite + React + Tailwind + /api 代理
├── vitest.config.ts           # 测试配置
├── tsconfig.json              # Project references（app + node）
├── eslint.config.js
└── package.json
```

---

## API 概览

### HTTP 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/discover` | GET | 扫描常见目录的 Git 仓库 |
| `/api/resolve?name=<folder>` | GET | 按文件夹名搜索 Git 仓库 |
| `/api/log?path=<repo>&limit=N` | GET | 获取仓库提交列表 |
| `/api/diff?path=<repo>&hash=<hash>&parentHash=<hash>` | GET | 获取某次 commit 的文件变更 |
| `/api/cache/stats` | GET | 查看缓存统计信息 |
| `/api/cache?path=<repo>` | DELETE | 清除指定仓库缓存（不传 path 则清除全部）|

### WebSocket（`ws://localhost:3001`）

**客户端 → 服务端：**
- `start_parse` `{ repoPath, repoName, maxCommits? }` — 启动解析
- `stop_parse` — 中止当前解析
- `request_diff` `{ repoPath, commitHash, filePath }` — 请求 diff 详情

**服务端 → 客户端：**
- `parse_started` / `parse_stopped` — 生命周期
- `progress` `{ phase, current, total, message }` — 进度
- `partial` — 阶段性 K 线结果（每 10 个 commit 推送一次）
- `complete` — 最终结果
- `diff_detail` — 文件 diff 详情
- `error`

完整类型定义见 [src/lib/types.ts](./src/lib/types.ts)。

---

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（端口 5173）|
| `npm run server` | 启动 Node 后端（端口 3001）|
| `npm run dev:all` | 同时启动前后端（推荐）|
| `npm run build` | TypeScript 类型检查 + 生产构建 |
| `npm run lint` | 运行 ESLint |
| `npm run test` | 运行 Vitest 单元测试 |
| `npm run preview` | 预览生产构建 |
| `npm run electron:dev` | Electron 开发模式 |
| `npm run electron:build` | 打包 Electron Portable 应用 |

---

## 已知限制

- 仅支持本地 Git 仓库（远程仓库未支持）
- 默认最多分析 300 次 commit，可在 `server/services/parser.js` 中调整
- 前端本地解析模式需浏览器支持 `showDirectoryPicker`（Firefox / Safari 暂不支持，可手动输入路径走后端解析）
- 大仓库首次解析可能较慢（`buildFileStocks` 单线程同步执行），后续打开有缓存加速
- 后端缓存持久化在文件系统，前端缓存使用 IndexedDB，两者独立

---

## 开发规约

- 提交前请运行 `npm run lint` 与 `npm run build`，确保类型与代码风格通过
- 新增 UI 颜色请使用 `index.css` 中已定义的 `ex-*` design tokens
- 修改 `buildFileStocks` 等业务逻辑时，请同步更新 [server/lib/kline-core.js](./server/lib/kline-core.js) 和 [src/lib/kline-core.ts](./src/lib/kline-core.ts) 保持前后端一致
- 测试文件与源文件同目录，命名为 `*.test.ts` / `*.test.js`
