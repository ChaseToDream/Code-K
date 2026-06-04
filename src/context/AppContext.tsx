import { createContext, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { RepoInfo, FileStock, ParseProgress, CommitDiff } from '../lib/types';
import { generateTicker, createCandle, calcChangePercent } from '../lib/kline-core';

// 应用状态
interface AppState {
  repos: Record<string, RepoInfo>;
  activeRepoId: string | null;
  selectedStock: FileStock | null;
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
  | { type: 'SELECT_STOCK'; stock: FileStock | null }
  | { type: 'SET_WS_CONNECTED'; connected: boolean };

// 初始状态
const initialState: AppState = {
  repos: {},
  activeRepoId: null,
  selectedStock: null,
  wsConnected: false,
};

/**
 * 将增量 commits 合并到现有 stocks 中
 * 增量 commits 按时间正序排列（旧 -> 新），追加到已有 candle 序列末尾
 */
function applyCommitsToStocks(
  existingStocks: FileStock[],
  newCommits: CommitDiff[],
  repoId: string
): FileStock[] {
  const stockMap = new Map(existingStocks.map(s => [s.path, s]));

  for (const diff of newCommits) {
    const { commit, files } = diff;

    for (const file of files) {
      let stock = stockMap.get(file.path);

      if (!stock) {
        // IPO：新文件首次出现
        const open = 0;
        const close = Math.max(0, file.additions - file.deletions);
        stock = {
          path: file.path,
          ticker: generateTicker(file.path),
          candles: [createCandle(open, close, file.additions + file.deletions, commit)],
          currentLines: close,
          status: 'ipo',
          firstCommit: commit,
          lastCommit: commit,
          totalAdditions: file.additions,
          totalDeletions: file.deletions,
          changePercent: close > 0 ? 100 : 0,
          repoId,
        };
        stockMap.set(file.path, stock);
      } else {
        // 已有文件追加 candle
        const open = stock.currentLines;
        const change = file.additions - file.deletions;
        const close = Math.max(0, open + change);

        stock.candles.push(createCandle(open, close, file.additions + file.deletions, commit));
        stock.currentLines = close;
        stock.totalAdditions += file.additions;
        stock.totalDeletions += file.deletions;
        stock.lastCommit = commit;
        stock.status = close === 0 && file.deletions > 0 ? 'delisted' : 'active';
        stock.changePercent = calcChangePercent(stock.candles[stock.candles.length - 1]);
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

      // 如果当前选中的股票属于该仓库，同步更新
      let newSelectedStock = state.selectedStock;
      if (state.selectedStock?.repoId === action.repoId) {
        const updated = updatedStocks.find(s => s.path === state.selectedStock!.path);
        if (updated) newSelectedStock = updated;
      }

      return { ...state, repos: { ...state.repos, [action.repoId]: { ...repo, stocks: updatedStocks } }, selectedStock: newSelectedStock };
    }
    case 'SET_REPO_STATUS': {
      const repo = state.repos[action.repoId];
      if (!repo) return state;
      return { ...state, repos: { ...state.repos, [action.repoId]: { ...repo, status: action.status, error: action.error } } };
    }
    case 'SELECT_STOCK': {
      return { ...state, selectedStock: action.stock };
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
