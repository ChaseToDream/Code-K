# CODE-K — 代码交易所

> 把 Git 仓库当成股市来可视化：**每个文件是一支"股票"**，每次 commit 是一根 K 线，代码增删即涨跌。

![status](https://img.shields.io/badge/status-MVP-orange) ![node](https://img.shields.io/badge/node-%E2%89%A520-339933) ![react](https://img.shields.io/badge/react-19-61dafb)

---

## 特性

- **文件即股票** — 仓库内每个文件都有独立行情：当前行数、最新涨跌、累计成交量、迷你走势
- **Commit 即 K 线** — 每次提交产生一根蜡烛（OHLC = 当时的代码行数变化）
- **IPO / 退市机制** — 新文件首次出现 = 新股上市；行数归零 = 退市
- **仓库自动发现** — 扫描 `~/Desktop`、`~/Documents`、`D:\codeFile` 等常见目录
- **实时解析进度** — WebSocket 推送 `progress` / `partial` / `complete` 三阶段
- **完整图表** — 蜡烛图（lightweight-charts）+ 迷你走势图 + 红绿 diff 对比
- **多仓库 Tab** — 同时打开多个仓库，标签页切换
- **赛博金融终端 UI** — Tailwind v4 + JetBrains Mono / Orbitron 字体

---

## 技术栈

| 层级 | 选型 |
|------|------|
| 前端 | React 19 · TypeScript 6 · Vite 8 · Tailwind CSS v4 |
| 路由 | react-router-dom v7 |
| 图表 | lightweight-charts v5 |
| 后端 | Node.js（原生 `child_process` 调 `git`）· `ws`（WebSocket）|
| 状态 | React Context + useReducer |

---

## 快速开始

### 环境要求

- Node.js ≥ 20
- Git 命令行工具在 `PATH` 中
- 浏览器需支持 `showDirectoryPicker`（Chrome / Edge 完整支持）

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

---

## 使用流程

1. **首页（Home）** — 选择文件夹或手动输入路径，自动验证是否为 Git 仓库
2. **行情页（Market）** — 查看所有"股票"列表，可按市值 / 涨跌 / 成交量 / 交易数排序，按状态筛选
3. **股票详情（StockDetail）** — 点击任意文件查看 K 线图、提交历史，点击具体 commit 可查看红绿 diff

---

## 架构

```
┌──────────┐  HTTP /api/discover      ┌──────────┐
│  Home    │ ───────────────────────→  │          │
│          │                           │  Server  │
│  Market  │  WebSocket: start_parse   │  (3001)  │
│  Detail  │ ←──── progress ────────   │          │
│          │ ←──── partial ─────────   │  + git   │
│          │ ←──── complete ────────   │          │
└──────────┘                           └──────────┘
     ↑                                       │
     └──── dev: 5173 ←── Vite proxy /api ────┘
```

### K 线生成规则

对每个文件，沿 commit 时间线维护一个"行数计数器"：

- 第一次出现该文件 → **IPO**（开盘 0，收盘 = 增 − 删）
- 后续 commit → 开盘 = 上次收盘，收盘 = 开盘 + (增 − 删)
- 收盘归零且有删除 → **退市**
- 成交量 = 该 commit 的增 + 删

实现见 [server/index.js](./server/index.js) `buildFileStocks()`。

---

## 目录结构

```
.
├── server/
│   └── index.js              # Node 后端（HTTP + WebSocket 单文件）
├── src/
│   ├── components/           # Layout / KlineChart / SparklineChart / DiffViewer / RepoTabs
│   ├── pages/                # Home / Market / StockDetail
│   ├── hooks/                # useAppContext / useRepo / useWebSocket
│   ├── context/              # AppContext（Context + Reducer）
│   ├── lib/                  # 类型定义（types.ts）
│   ├── utils/                # 工具函数
│   ├── polyfills.ts          # Buffer polyfill
│   ├── App.tsx / main.tsx
│   └── index.css             # Tailwind v4 + 自定义主题（ex-* design tokens）
├── public/                   # 静态资源
├── index.html
├── vite.config.ts            # @vitejs/plugin-react + @tailwindcss/vite + /api 代理
├── tsconfig.json             # Project references（app + node）
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
| `npm run preview` | 预览生产构建 |

---

## 已知限制

- 仅支持本地 Git 仓库（远程仓库未支持）
- 默认最多分析 300 次 commit，可在 `server/index.js` 的 `getCommits()` 中调整
- 浏览器需支持 `showDirectoryPicker`（Firefox / Safari 暂不支持，可手动输入路径）
- 大仓库首次解析可能较慢（`buildFileStocks` 单线程同步执行）
- 刷新页面仓库状态不保留（仅内存存储）
- 前端 `src/lib/kline-data.ts` 是服务端 `buildFileStocks` 的旧客户端副本，目前未被引用（解析全部在服务端完成）

---

## 开发规约

- 提交前请运行 `npm run lint` 与 `npm run build`，确保类型与代码风格通过
- 新增 UI 颜色请使用 `index.css` 中已定义的 `ex-*` design tokens
- 修改 `buildFileStocks` 等业务逻辑时，请同步考虑前后端一致性
