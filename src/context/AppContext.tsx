import { createContext, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { RepoInfo, FileStock, ParseProgress, CommitDiff } from '../lib/types';
import { generateTicker, createCandle, calcChangePercent } from '../lib/kline-core';

// 应用状态
interface AppState {
  repos: Record<string, RepoInfo>;
  activeRepoId: string | null;
  wsConnected: boolean;
}

// 应用操作
type AppAction =
  | { type: 'ADD_REPO'; repo: RepoInfo }
  | { type: 'REMOVE_REPO'; repoId: string }
  | { type: 'SET_ACTIVE_REPO'; repoId: string }
  | { type: 'UPDATE_REPO_PROGRESS'; repoId: string; progress: ParseProgress }
  | { type: 'UPDATE_REPO_STOCKS'; repoId: string; stocks: FileStock[] }
  | { type: 'APPEND_REPO_COMMITS'; repoId: string; commits: CommitDiff[] }
  | { type: 'SET_REPO_STATUS'; repoId: string; status: RepoInfo['status']; error?: string }
  | { type: 'SET_WS_CONNECTED'; connected: boolean };

// 初始状态
const initialState: AppState = {
  repos: {},
  activeRepoId: null,
  wsConnected: false,
};

/**
 * 将增量 commits 合并到现有 stocks 中
 * 增量 commits 按时间正序排列（旧 -> 新），追加到已有 candle 序列末尾
 *
 * 不可变更新：命中的 FileStock 一律浅拷贝（candles 数组复制后再追加），
 * 绝不原地突变 state 中已有的对象，保证 React 引用比较能检测到变化。
 */
function applyCommitsToStocks(
  existingStocks: FileStock[],
  newCommits: CommitDiff[],
  repoId: string
): FileStock[] {
  const stockMap = new Map(existingStocks.map(s => [s.path, s]));
  // 记录已拷贝过的 path，避免同一次合并中对同一 stock 重复拷贝
  const copied = new Set<string>();

  /** 取 path 对应的 stock 的可写拷贝（首次访问时浅拷贝 + 复制 candles） */
  const mutableCopy = (path: string): FileStock | undefined => {
    const stock = stockMap.get(path);
    if (!stock) return undefined;
    if (!copied.has(path)) {
      const copy: FileStock = { ...stock, candles: [...stock.candles] };
      stockMap.set(path, copy);
      copied.add(path);
      return copy;
    }
    return stock;
  };

  for (const diff of newCommits) {
    const { commit, files } = diff;

    for (const file of files) {
      // 重命名：把旧路径的 stock 迁移到新路径（与 server buildFileStocks 保持一致）
      if (file.renamedFrom && file.path !== file.renamedFrom && stockMap.has(file.renamedFrom)) {
        const oldStock = mutableCopy(file.renamedFrom)!;
        stockMap.delete(file.renamedFrom);
        copied.delete(file.renamedFrom);
        oldStock.path = file.path;
        oldStock.ticker = generateTicker(file.path);
        stockMap.set(file.path, oldStock);
        copied.add(file.path);
      }

      let stock = mutableCopy(file.path);

      if (!stock) {
        // IPO：新文件首次出现（增量场景下首次出现即最新 commit → ipo，与 buildFileStocks 全量规则一致）
        const open = 0;
        const close = Math.max(0, file.additions - file.deletions);
        const candle = createCandle(commit, file, open, close);
        stock = {
          path: file.path,
          ticker: generateTicker(file.path),
          candles: [candle],
          currentLines: close,
          status: 'ipo',
          firstCommit: commit,
          lastCommit: commit,
          totalAdditions: file.additions,
          totalDeletions: file.deletions,
          changePercent: calcChangePercent(candle),
          repoId,
        };
        stockMap.set(file.path, stock);
      } else {
        // 已有文件追加 candle
        const open = stock.currentLines;
        const change = file.additions - file.deletions;
        const close = Math.max(0, open + change);
        const candle = createCandle(commit, file, open, close);

        stock.candles.push(candle);
        stock.currentLines = close;
        stock.totalAdditions += file.additions;
        stock.totalDeletions += file.deletions;
        stock.lastCommit = commit;
        // 状态机与 buildFileStocks 全量规则对齐：
        // - delisted 粘性（曾经清零退市即保持）
        // - 单根蜡烛 → ipo，之后 → active
        const delisted = stock.status === 'delisted' || (close === 0 && file.deletions > 0);
        stock.status = delisted ? 'delisted' : stock.candles.length === 1 ? 'ipo' : 'active';
        stock.changePercent = calcChangePercent(candle);
      }
    }
  }

  const result = Array.from(stockMap.values());
  result.sort((a, b) => b.currentLines - a.currentLines);
  return result;
}

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_REPO': {
      return { ...state, repos: { ...state.repos, [action.repo.id]: action.repo }, activeRepoId: action.repo.id };
    }
    case 'REMOVE_REPO': {
      const newRepos = { ...state.repos };
      delete newRepos[action.repoId];
      const remainingIds = Object.keys(newRepos);
      const newActiveId = state.activeRepoId === action.repoId
        ? (remainingIds[0] || null)
        : state.activeRepoId;
      return { ...state, repos: newRepos, activeRepoId: newActiveId };
    }
    case 'SET_ACTIVE_REPO': {
      return { ...state, activeRepoId: action.repoId };
    }
    case 'UPDATE_REPO_PROGRESS': {
      const repo = state.repos[action.repoId];
      if (!repo) return state;
      return { ...state, repos: { ...state.repos, [action.repoId]: { ...repo, progress: action.progress } } };
    }
    case 'UPDATE_REPO_STOCKS': {
      const repo = state.repos[action.repoId];
      if (!repo) return state;
      return { ...state, repos: { ...state.repos, [action.repoId]: { ...repo, stocks: action.stocks } } };
    }
    case 'APPEND_REPO_COMMITS': {
      const repo = state.repos[action.repoId];
      if (!repo) return state;

      const updatedStocks = applyCommitsToStocks(repo.stocks, action.commits, action.repoId);

      return { ...state, repos: { ...state.repos, [action.repoId]: { ...repo, stocks: updatedStocks } } };
    }
    case 'SET_REPO_STATUS': {
      const repo = state.repos[action.repoId];
      if (!repo) return state;
      return { ...state, repos: { ...state.repos, [action.repoId]: { ...repo, status: action.status, error: action.error } } };
    }
    case 'SET_WS_CONNECTED': {
      return { ...state, wsConnected: action.connected };
    }
    default:
      return state;
  }
}

// Context 类型
interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

// 创建 Context
const AppContext = createContext<AppContextType | undefined>(undefined);

// Provider 组件
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

// 导出 Context 供 hooks 使用
export { AppContext };
export type { AppState, AppAction };
