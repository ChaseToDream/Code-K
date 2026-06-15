import { useCallback } from 'react';
import { useAppContext } from './useAppContext';
import { useWebSocket } from './useWebSocket';
import { useLocalParser } from './useLocalParser';
import { generateRepoId } from '../lib/kline-core';
import type { RepoInfo, FileStock } from '../lib/types';

export function useRepo() {
  const { state, dispatch } = useAppContext();
  const { sendStartParse, sendStopParse } = useWebSocket();
  const { refreshLocalRepo } = useLocalParser();

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
      parseMode: 'backend',
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

  // 刷新仓库：根据仓库的解析模式路由到对应刷新路径
  // - local 模式：清除缓存并用 Worker 重新解析（无需后端）
  // - backend 模式：保留旧数据作兜底，触发服务端重新解析
  const refreshRepo = useCallback(async (repoPath: string, repoName: string, maxCommits?: number) => {
    const repoId = generateRepoId(repoPath);
    const repo = state.repos[repoId];

    // 本地解析模式：走 Worker 刷新
    if (repo?.parseMode === 'local') {
      const handled = await refreshLocalRepo(repoId);
      if (handled) return repoId;
    }

    // 后端解析模式（或本地刷新未命中）：走 WebSocket
    dispatch({ type: 'SET_REPO_STATUS', repoId, status: 'parsing' });
    sendStartParse(repoPath, repoName, maxCommits);
    return repoId;
  }, [state.repos, dispatch, sendStartParse, refreshLocalRepo]);

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
