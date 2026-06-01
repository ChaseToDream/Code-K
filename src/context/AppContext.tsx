import { createContext, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { RepoInfo, FileStock, ParseProgress } from '../lib/types';

// 应用状态
interface AppState {
  repos: Map<string, RepoInfo>;
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
  | { type: 'SET_REPO_STATUS'; repoId: string; status: RepoInfo['status']; error?: string }
  | { type: 'SELECT_STOCK'; stock: FileStock | null }
  | { type: 'SET_WS_CONNECTED'; connected: boolean };

// 初始状态
const initialState: AppState = {
  repos: new Map(),
  activeRepoId: null,
  selectedStock: null,
  wsConnected: false,
};

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_REPO': {
      const newRepos = new Map(state.repos);
      newRepos.set(action.repo.id, action.repo);
      return { ...state, repos: newRepos, activeRepoId: action.repo.id };
    }
    case 'REMOVE_REPO': {
      const newRepos = new Map(state.repos);
      newRepos.delete(action.repoId);
      const newActiveId = state.activeRepoId === action.repoId
        ? newRepos.keys().next().value || null
        : state.activeRepoId;
      return { ...state, repos: newRepos, activeRepoId: newActiveId };
    }
    case 'SET_ACTIVE_REPO': {
      return { ...state, activeRepoId: action.repoId };
    }
    case 'UPDATE_REPO_PROGRESS': {
      const newRepos = new Map(state.repos);
      const repo = newRepos.get(action.repoId);
      if (repo) {
        newRepos.set(action.repoId, { ...repo, progress: action.progress });
      }
      return { ...state, repos: newRepos };
    }
    case 'UPDATE_REPO_STOCKS': {
      const newRepos = new Map(state.repos);
      const repo = newRepos.get(action.repoId);
      if (repo) {
        newRepos.set(action.repoId, { ...repo, stocks: action.stocks });
      }
      return { ...state, repos: newRepos };
    }
    case 'SET_REPO_STATUS': {
      const newRepos = new Map(state.repos);
      const repo = newRepos.get(action.repoId);
      if (repo) {
        newRepos.set(action.repoId, { ...repo, status: action.status, error: action.error });
      }
      return { ...state, repos: newRepos };
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
