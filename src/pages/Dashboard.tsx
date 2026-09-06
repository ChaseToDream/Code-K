import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRepo } from '../hooks/useRepo'
import { useMarketIndex } from '../hooks/useMarketIndex'
import RepoTabs from '../components/RepoTabs'
import MarketIndexChart from '../components/MarketIndexChart'
import MarketStats from '../components/MarketStats'
import TopMovers from '../components/TopMovers'
import { ChartSkeleton } from '../components/Skeleton'

/**
 * 大盘页面：展示仓库级综合指数和市场统计
 */
export default function Dashboard() {
  const { activeRepo, activeRepoId, repos, setActiveRepo, removeRepo, refreshRepo } = useRepo()
  const stocks = activeRepo?.stocks || []
  const isParsing = activeRepo?.status === 'parsing'
  const [isRefreshing, setIsRefreshing] = useState(false)
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 组件卸载时清理刷新锁定定时器
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current)
    }
  }, [])

  const handleRefresh = () => {
    if (!activeRepoId || isParsing || isRefreshing) return
    setIsRefreshing(true)
    refreshRepo(activeRepoId)
    // 3秒后解除刷新锁定（防止用户狂点）
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current)
    refreshTimeoutRef.current = setTimeout(() => setIsRefreshing(false), 3000)
  }

  const {
    indexCandles,
    currentIndex,
    indexChange,
    indexChangePercent,
    marketStats,
    sectors,
    topGainers,
    topLosers,
    topVolume,
  } = useMarketIndex(stocks)

  const isUp = indexChange >= 0

  // 没有仓库时显示空状态
  if (repos.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-ex-dim text-lg">暂无数据</p>
          <Link to="/" className="text-ex-accent text-sm hover:underline">返回首页选择仓库</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* 仓库标签 + 刷新 */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <RepoTabs
            repos={repos}
            activeRepoId={activeRepo?.id || null}
            onRepoSelect={setActiveRepo}
            onRepoClose={removeRepo}
          />
        </div>
        <button
          onClick={handleRefresh}
          disabled={isParsing || isRefreshing || !activeRepo}
          className={`shrink-0 px-3 py-2 text-xs font-mono rounded border transition-colors cursor-pointer flex items-center gap-1.5
            ${isParsing || isRefreshing
              ? 'bg-ex-surface border-ex-border text-ex-dim cursor-not-allowed'
              : 'bg-ex-surface border-ex-border text-ex-dim hover:text-ex-accent hover:border-ex-accent/40'
            }`}
          title="刷新仓库数据"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${isRefreshing ? 'animate-spin' : ''}`}>
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          {isRefreshing ? '刷新中...' : '刷新'}
        </button>
      </div>

      {/* 综合指数区域 */}
      <div className="bg-ex-surface border border-ex-border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-sm font-mono text-ex-dim uppercase tracking-wider">CODE-K Index</h2>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-3xl font-mono font-bold text-ex-heading">
                {currentIndex.toFixed(2)}
              </span>
              <span className={`text-sm font-mono ${isUp ? 'text-ex-green' : 'text-ex-red'}`}>
                {isUp ? '+' : ''}{indexChange.toFixed(2)}
              </span>
              <span className={`text-sm font-mono ${isUp ? 'text-ex-green' : 'text-ex-red'}`}>
                ({isUp ? '+' : ''}{indexChangePercent.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-ex-dim">
            <div className="text-right">
              <div>基期: 1000.00</div>
              <div> commits: {marketStats.totalCommits.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {isParsing && stocks.length === 0 ? (
          <ChartSkeleton />
        ) : (
          <MarketIndexChart candles={indexCandles} />
        )}
      </div>

      {/* 市场统计面板 */}
      <MarketStats stats={marketStats} sectors={sectors} />

      {/* 热门排行 */}
      <TopMovers gainers={topGainers} losers={topLosers} volume={topVolume} />
    </div>
  )
}
