import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRepo } from '../hooks/useRepo'
import SparklineChart from '../components/SparklineChart'
import RepoTabs from '../components/RepoTabs'

type SortKey = 'lines' | 'change' | 'volume' | 'commits'
type FilterStatus = 'all' | 'active' | 'ipo' | 'delisted'

function formatTimeRemaining(ms: number): string {
  if (ms < 1000) return '< 1秒'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}分${remainingSeconds}秒`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}时${remainingMinutes}分`
}

export default function Market() {
  const { activeRepo, repos, setActiveRepo, removeRepo, selectStock } = useRepo()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('lines')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')

  const stocks = useMemo(() => activeRepo?.stocks || [], [activeRepo?.stocks])
  const isParsing = activeRepo?.status === 'parsing'
  const parseProgress = activeRepo?.progress
  const parseError = activeRepo?.error

  const filtered = useMemo(() => {
    let result = stocks
    if (filterStatus !== 'all') result = result.filter(s => s.status === filterStatus)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(s => s.path.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q))
    }
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case 'lines': return b.currentLines - a.currentLines
        case 'change': return b.changePercent - a.changePercent
        case 'volume': return (b.totalAdditions + b.totalDeletions) - (a.totalAdditions + a.totalDeletions)
        case 'commits': return b.candles.length - a.candles.length
        default: return 0
      }
    })
  }, [stocks, search, sortBy, filterStatus])

  const totalLines = stocks.reduce((s, st) => s + st.currentLines, 0)
  const avgChange = stocks.length > 0 ? stocks.reduce((s, st) => s + st.changePercent, 0) / stocks.length : 0
  const progressPercent = parseProgress ? Math.round((parseProgress.current / Math.max(1, parseProgress.total)) * 100) : 0

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
      {/* 仓库标签 */}
      <RepoTabs
        repos={repos}
        activeRepoId={activeRepo?.id || null}
        onRepoSelect={setActiveRepo}
        onRepoClose={removeRepo}
      />

      {/* 解析进度 */}
      {isParsing && parseProgress && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-ex-text">{parseProgress.message}</span>
            <span className="text-ex-accent">{progressPercent}%</span>
          </div>
          <div className="h-2 bg-ex-surface rounded-full overflow-hidden border border-ex-border">
            <div className="h-full bg-ex-accent rounded-full transition-all duration-300 progress-stripe" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="flex justify-between text-xs font-mono text-ex-dim">
            {parseProgress.currentFile && (
              <span className="truncate max-w-md">当前: {parseProgress.currentFile}</span>
            )}
            {parseProgress.estimatedTimeRemaining !== undefined && parseProgress.estimatedTimeRemaining > 0 && (
              <span>预计剩余: {formatTimeRemaining(parseProgress.estimatedTimeRemaining)}</span>
            )}
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {parseError && (
        <div className="bg-ex-red/10 border border-ex-red/30 rounded-lg px-4 py-3 text-ex-red text-sm font-mono text-center">
          {parseError}
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '股票总数', value: stocks.length.toString(), color: 'text-ex-heading' },
          { label: '代码总行数', value: totalLines.toLocaleString(), color: 'text-ex-heading' },
          { label: '平均变化', value: `${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%`, color: avgChange >= 0 ? 'text-ex-green' : 'text-ex-red' },
          { label: '仓库', value: activeRepo?.name || '-', color: 'text-ex-accent' },
        ].map((stat) => (
          <div key={stat.label} className="bg-ex-surface border border-ex-border rounded-lg p-4">
            <div className="text-xs text-ex-dim font-mono mb-1">{stat.label}</div>
            <div className={`text-lg font-mono font-semibold ${stat.color} truncate`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* 搜索和筛选 */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ex-dim" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input type="text" placeholder="搜索文件路径或代码..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-ex-surface border border-ex-border rounded-lg pl-10 pr-4 py-2.5 text-sm font-mono text-ex-heading placeholder:text-ex-dim focus:outline-none focus:border-ex-accent/50 transition-colors" />
        </div>
        <div className="flex items-center gap-1 bg-ex-surface border border-ex-border rounded-lg p-1">
          {([['all', '全部'], ['active', '正常'], ['ipo', '新股'], ['delisted', '退市']] as [FilterStatus, string][]).map(([status, label]) => (
            <button key={status} onClick={() => setFilterStatus(status)}
              className={`px-3 py-1.5 text-xs font-mono rounded transition-colors cursor-pointer ${filterStatus === status ? 'bg-ex-accent/20 text-ex-accent' : 'text-ex-dim hover:text-ex-text'}`}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-ex-surface border border-ex-border rounded-lg p-1">
          {([['lines', '市值'], ['change', '涨跌'], ['volume', '成交量'], ['commits', '交易数']] as [SortKey, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setSortBy(key)}
              className={`px-3 py-1.5 text-xs font-mono rounded transition-colors cursor-pointer ${sortBy === key ? 'bg-ex-accent/20 text-ex-accent' : 'text-ex-dim hover:text-ex-text'}`}>{label}</button>
          ))}
        </div>
      </div>

      {/* 股票列表 */}
      <div className="bg-ex-surface border border-ex-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[2fr_80px_100px_100px_100px_140px] gap-4 px-6 py-3 border-b border-ex-border text-xs font-mono text-ex-dim">
          <span>文件</span><span className="text-right">状态</span><span className="text-right">行数</span><span className="text-right">涨跌</span><span className="text-right">成交量</span><span className="text-right">走势</span>
        </div>
        <div className="divide-y divide-ex-border/50 max-h-[calc(100vh-340px)] overflow-y-auto">
          {isParsing && stocks.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center space-y-2">
                <div className="w-2 h-2 rounded-full bg-ex-accent pulse-glow mx-auto" />
                <p className="text-ex-dim text-sm font-mono">正在解析仓库...</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-ex-dim text-sm font-mono">暂无匹配的股票</p>
            </div>
          ) : (
            filtered.map((stock) => (
              <Link key={stock.path} to={`/stock/${encodeURIComponent(stock.path)}`}
                onClick={() => selectStock(stock)}
                className="grid grid-cols-[2fr_80px_100px_100px_100px_140px] gap-4 px-6 py-3 hover:bg-ex-panel/50 transition-colors no-underline items-center">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-ex-heading truncate">{stock.ticker}</span>
                    {stock.status === 'ipo' && <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-ex-gold/15 text-ex-gold rounded glow-gold">新股</span>}
                    {stock.status === 'delisted' && <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-ex-dim/15 text-ex-dim rounded">退市</span>}
                  </div>
                  <span className="text-xs text-ex-dim truncate">{stock.path}</span>
                </div>
                <div className="text-right"><span className={`inline-block w-2 h-2 rounded-full ${stock.status === 'active' ? 'bg-ex-green' : stock.status === 'ipo' ? 'bg-ex-gold' : 'bg-ex-dim'}`} /></div>
                <div className="text-right font-mono text-sm text-ex-heading">{stock.currentLines.toLocaleString()}</div>
                <div className={`text-right font-mono text-sm font-semibold ${stock.changePercent >= 0 ? 'text-ex-green glow-green' : 'text-ex-red glow-red'}`}>
                  {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                </div>
                <div className="text-right font-mono text-sm text-ex-text">{(stock.totalAdditions + stock.totalDeletions).toLocaleString()}</div>
                <div className="flex justify-end"><SparklineChart candles={stock.candles} width={120} height={32} /></div>
              </Link>
            ))
          )}
        </div>
      </div>
      <div className="text-xs font-mono text-ex-dim text-right">共 {stocks.length} 支股票，当前显示 {filtered.length} 支</div>
    </div>
  )
}
