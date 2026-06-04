import { useContext } from 'react';
import { AppContext } from '../context/AppContext';

// Hook
export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

// 辅助 Hook：获取当前活跃仓库
export function useActiveRepo() {
  const { state } = useAppContext();
  const { repos, activeRepoId } = state;
  return activeRepoId ? repos[activeRepoId] : null;
}

// 辅助 Hook：获取所有仓库列表
export function useRepos() {
  const { state } = useAppContext();
  return Object.values(state.repos);
}
