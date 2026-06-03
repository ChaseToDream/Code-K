import { useRepo } from '../hooks/useRepo'
import { useMarketIndex } from '../hooks/useMarketIndex'
import RepoTabs from '../components/RepoTabs'
import MarketIndexChart from '../components/MarketIndexChart'
import MarketStats from '../components/MarketStats'
import TopMovers from '../components/TopMovers'

/**
 * 大盘页面：展示仓库级综合指数和市场统计
 */
export default function Dashboard() {
  const { activeRepo, repos, setActiveRepo, removeRepo } = useRepo()
  const stocks = activeRepo?.stocks || []

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
          <a href="/" className="text-ex-accent text-sm hover:underline">返回首页选择仓库</a>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* 仓库标签 */}
      <RepoTabs
        repos={repos}
        activeRepoId={activeRepo?.id || null}
        onRepoSelect={setActiveRepo}
        onRepoClose={removeRepo}
      />

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

        <MarketIndexChart candles={indexCandles} />
      </div>

      {/* 市场统计面板 */}
      <MarketStats stats={marketStats} sectors={sectors} />

      {/* 热门排行 */}
      <TopMovers gainers={topGainers} losers={topLosers} volume={topVolume} />
    </div>
  )
}
