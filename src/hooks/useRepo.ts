import { useCallback } from 'react';
import { useAppContext } from './useAppContext';
import { useWebSocket } from './useWebSocket';
import { generateRepoId } from '../lib/kline-core';
import type { RepoInfo, FileStock } from '../lib/types';

export function useRepo() {
  const { state, dispatch } = useAppContext();
  const { sendStartParse, sendStopParse } = useWebSocket();

  // 添加仓库
  const addRepo = useCallback((repoPath: string, repoName: string) => {
    const repoId = generateRepoId(repoPath);
    
    // 检查是否已存在
    if (state.repos[repoId]) {
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

  // 刷新仓库：保留旧数据作兜底，触发服务端重新解析
  // 不清空 stocks，避免刷新到新数据到达之间出现空白期
  const refreshRepo = useCallback((repoPath: string, repoName: string, maxCommits?: number) => {
    const repoId = generateRepoId(repoPath);
    dispatch({ type: 'SET_REPO_STATUS', repoId, status: 'parsing' });
    sendStartParse(repoPath, repoName, maxCommits);
    return repoId;
  }, [dispatch, sendStartParse]);

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
  const activeRepo = state.activeRepoId ? state.repos[state.activeRepoId] : null;

  // 获取所有仓库
  const repos = Object.values(state.repos);

  return {
    activeRepo,
    repos,
    addRepo,
    startParsing,
    stopParsing,
    refreshRepo,
    removeRepo,
    setActiveRepo,
    selectStock,
    selectedStock: state.selectedStock,
    wsConnected: state.wsConnected,
  };
}
