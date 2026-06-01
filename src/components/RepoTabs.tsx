import type { RepoInfo } from '../lib/types'

interface RepoTabsProps {
  repos: RepoInfo[];
  activeRepoId: string | null;
  onRepoSelect: (repoId: string) => void;
  onRepoClose: (repoId: string) => void;
}

export default function RepoTabs({ repos, activeRepoId, onRepoSelect, onRepoClose }: RepoTabsProps) {
  if (repos.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {repos.map((repo) => {
        const isActive = repo.id === activeRepoId;
        const isParsing = repo.status === 'parsing';
        const isError = repo.status === 'error';
        const progress = repo.progress;
        const progressPercent = progress
          ? Math.round((progress.current / Math.max(1, progress.total)) * 100)
          : 0;

        return (
          <div
            key={repo.id}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all
              ${isActive
                ? 'bg-ex-accent/10 border-ex-accent/30 text-ex-accent'
                : 'bg-ex-surface border-ex-border text-ex-dim hover:text-ex-text hover:border-ex-border/80'
              }
              ${isError ? 'border-ex-red/30' : ''}
            `}
            onClick={() => onRepoSelect(repo.id)}
          >
            {/* 状态指示器 */}
            <span className={`w-2 h-2 rounded-full shrink-0
              ${isParsing ? 'bg-ex-accent pulse-glow' : isError ? 'bg-ex-red' : repo.status === 'ready' ? 'bg-ex-green' : 'bg-ex-dim'}
            `} />

            {/* 仓库名称 */}
            <span className="font-mono text-sm font-semibold truncate max-w-[120px]">
              {repo.name}
            </span>

            {/* 进度或股票数 */}
            {isParsing ? (
              <span className="text-xs font-mono text-ex-dim">
                {progressPercent}%
              </span>
            ) : repo.status === 'ready' ? (
              <span className="text-xs font-mono text-ex-dim">
                {repo.stocks.length}支
              </span>
            ) : isError ? (
              <span className="text-xs font-mono text-ex-red">错误</span>
            ) : null}

            {/* 关闭按钮 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRepoClose(repo.id);
              }}
              className="ml-1 text-ex-dim hover:text-ex-red transition-colors p-0.5"
              title="关闭仓库"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
