import { useCallback } from 'react';
import { useAppContext } from './useAppContext';
import { useWebSocket } from './useWebSocket';
import type { RepoInfo, FileStock } from '../lib/types';

// 生成仓库ID
function generateRepoId(repoPath: string): string {
  return btoa(repoPath).slice(0, 12);
}

export function useRepo() {
  const { state, dispatch } = useAppContext();
  const { sendStartParse, sendStopParse } = useWebSocket();

  // 添加仓库
  const addRepo = useCallback((repoPath: string, repoName: string) => {
    const repoId = generateRepoId(repoPath);
    
    // 检查是否已存在
    if (state.repos.has(repoId)) {
      dispatch({ type: 'SET_ACTIVE_REPO', repoId });
      return repoId;
    }

    const newRepo: RepoInfo = {
      id: repoId,
      path: repoPath,
      name: repoName,
      status: 'idle',
      stocks: [],
    };

    dispatch({ type: 'ADD_REPO', repo: newRepo });
    return repoId;
  }, [state.repos, dispatch]);

  // 开始解析仓库
  const startParsing = useCallback((repoPath: string, repoName: string, maxCommits?: number) => {
    const repoId = addRepo(repoPath, repoName);
    sendStartParse(repoPath, repoName, maxCommits);
    return repoId;
  }, [addRepo, sendStartParse]);

  // 停止解析
  const stopParsing = useCallback(() => {
    sendStopParse();
  }, [sendStopParse]);

  // 删除仓库
  const removeRepo = useCallback((repoId: string) => {
    if (state.activeRepoId === repoId) {
      sendStopParse();
    }
    dispatch({ type: 'REMOVE_REPO', repoId });
  }, [state.activeRepoId, dispatch, sendStopParse]);

  // 切换活跃仓库
  const setActiveRepo = useCallback((repoId: string) => {
    dispatch({ type: 'SET_ACTIVE_REPO', repoId });
  }, [dispatch]);

  // 选择股票
  const selectStock = useCallback((stock: FileStock | null) => {
    dispatch({ type: 'SELECT_STOCK', stock });
  }, [dispatch]);

  // 获取当前仓库
  const activeRepo = state.activeRepoId ? state.repos.get(state.activeRepoId) : null;

  // 获取所有仓库
  const repos = Array.from(state.repos.values());

  return {
    activeRepo,
    repos,
    addRepo,
    startParsing,
    stopParsing,
    removeRepo,
    setActiveRepo,
    selectStock,
    selectedStock: state.selectedStock,
    wsConnected: state.wsConnected,
  };
}
