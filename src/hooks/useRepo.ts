import { useCallback, useEffect, useRef } from 'react';
import { useAppContext } from './useAppContext';
import { useWebSocket } from './useWebSocket';
import { useLocalParser } from './useLocalParser';
import { generateRepoId } from '../lib/kline-core';
import type { RepoInfo } from '../lib/types';

export function useRepo() {
  const { state, dispatch } = useAppContext();
  const { sendStartParse, sendStopParse, onReconnect } = useWebSocket();
  const { refreshLocalRepo, stopLocalParse } = useLocalParser();

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

  // 停止解析：按解析模式路由（local 仓库绝不走 WS）
  const stopParsing = useCallback((repoId: string) => {
    const repo = state.repos[repoId];
    if (!repo) return;

    if (repo.parseMode === 'local') {
      stopLocalParse(repoId);
      dispatch({ type: 'SET_REPO_STATUS', repoId, status: 'idle' });
    } else {
      sendStopParse(repo.path);
    }
  }, [state.repos, dispatch, sendStopParse, stopLocalParse]);

  // 刷新仓库：按解析模式路由
  // - local 模式：清除缓存并用 Worker 重新解析（绝不走 WS）
  // - backend 模式：保留旧数据作兜底，触发服务端重新解析
  const refreshRepo = useCallback((repoId: string) => {
    const repo = state.repos[repoId];
    if (!repo) return;

    if (repo.parseMode === 'local') {
      void refreshLocalRepo(repoId);
      return;
    }

    dispatch({ type: 'SET_REPO_STATUS', repoId, status: 'parsing' });
    sendStartParse(repo.path, repo.name);
  }, [state.repos, dispatch, sendStartParse, refreshLocalRepo]);

  // 删除仓库：终止对应的后端解析任务与可能的本地 Worker
  const removeRepo = useCallback((repoId: string) => {
    const repo = state.repos[repoId];
    if (repo && repo.parseMode !== 'local') {
      sendStopParse(repo.path);
    }
    // 无论当前模式都尝试终止本地 Worker（无对应 Worker 时为 no-op）
    stopLocalParse(repoId);
    dispatch({ type: 'REMOVE_REPO', repoId });
  }, [state.repos, dispatch, sendStopParse, stopLocalParse]);

  // 切换活跃仓库
  const setActiveRepo = useCallback((repoId: string) => {
    dispatch({ type: 'SET_ACTIVE_REPO', repoId });
  }, [dispatch]);

  // WS 重连（含首次连接）后：对仍在 parsing 的后端仓库自动重发 start_parse
  const reposRef = useRef(state.repos);
  useEffect(() => {
    reposRef.current = state.repos;
  }, [state.repos]);

  useEffect(() => {
    return onReconnect(() => {
      for (const repo of Object.values(reposRef.current)) {
        if (repo.status === 'parsing' && repo.parseMode === 'backend') {
          console.log('[WebSocket] Reconnected, resuming parse for', repo.name);
          sendStartParse(repo.path, repo.name);
        }
      }
    });
  }, [onReconnect, sendStartParse]);

  // 获取当前仓库
  const activeRepo = state.activeRepoId ? state.repos[state.activeRepoId] : null;

  // 获取所有仓库
  const repos = Object.values(state.repos);

  return {
    activeRepo,
    activeRepoId: state.activeRepoId,
    repos,
    addRepo,
    startParsing,
    stopParsing,
    refreshRepo,
    removeRepo,
    setActiveRepo,
    wsConnected: state.wsConnected,
  };
}
