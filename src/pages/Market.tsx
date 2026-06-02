import { useMemo, useState } from 'react'
import { useRepo } from '../hooks/useRepo'
import RepoTabs from '../components/RepoTabs'
import VirtualStockList from '../components/VirtualStockList'
import { StockTableSkeleton } from '../components/Skeleton'

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
  const [useRegex, setUseRegex] = useState(false)
  const [authorFilter, setAuthorFilter] = useState('')

  const stocks = useMemo(() => activeRepo?.stocks || [], [activeRepo?.stocks])
  const isParsing = activeRepo?.status === 'parsing'
  const parseProgress = activeRepo?.progress
  const parseError = activeRepo?.error

  // 获取所有作者列表
  const authors = useMemo(() => {
    const authorSet = new Set<string>()
    stocks.forEach(stock => {
      stock.candles.forEach(candle => {
        if (candle.author) authorSet.add(candle.author)
      })
    })
    return Array.from(authorSet).sort()
  }, [stocks])

  const filtered = useMemo(() => {
    let result = stocks
    if (filterStatus !== 'all') result = result.filter(s => s.status === filterStatus)
    
    // 按作者筛选
    if (authorFilter) {
      result = result.filter(s => s.candles.some(c => c.author === authorFilter))
    }
    
    // 搜索过滤
    if (search) {
      if (useRegex) {
        try {
          const regex = new RegExp(search, 'i')
          result = result.filter(s => regex.test(s.path) || regex.test(s.ticker))
        } catch {
          // 正则表达式无效时忽略
        }
      } else {
        const q = search.toLowerCase()
        result = result.filter(s => s.path.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q))
      }
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
  }, [stocks, search, sortBy, filterStatus, useRegex, authorFilter])

  const totalLines = stocks.reduce((s, st) => s + st.currentLines, 0)
  const avgChange = stocks.length > 0 ? stocks.reduce((s, st) => s + st.changePercent, 0) / stocks.length : 0
  const progressPercent = parseProgress ? Math.round((parseProgress.current / Math.max(1, parseProgress.total)) * 100) : 0

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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ex-dim" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder={useRegex ? "输入正则表达式..." : "搜索文件路径或代码..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-ex-surface border border-ex-border rounded-lg pl-10 pr-4 py-2.5 text-sm font-mono text-ex-heading placeholder:text-ex-dim focus:outline-none focus:border-ex-accent/50 transition-colors"
            />
          </div>
          <button
            onClick={() => setUseRegex(!useRegex)}
            className={`px-3 py-2.5 text-xs font-mono rounded border transition-colors cursor-pointer
              ${useRegex ? 'bg-ex-accent/20 border-ex-accent/40 text-ex-accent' : 'bg-ex-surface border-ex-border text-ex-dim hover:text-ex-text'}`}
            title="正则表达式"
          >
            .*
          </button>
        </div>
        
        {authors.length > 0 && (
          <select
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            className="bg-ex-surface border border-ex-border rounded-lg px-3 py-2.5 text-xs font-mono text-ex-heading focus:outline-none focus:border-ex-accent/50 transition-colors cursor-pointer"
          >
            <option value="">所有作者</option>
            {authors.map(author => (
              <option key={author} value={author}>{author}</option>
            ))}
          </select>
        )}
        
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

      {/* 虚拟滚动股票列表 */}
      <div className="bg-ex-surface border border-ex-border rounded-lg overflow-hidden">
        {isParsing && stocks.length === 0 ? (
          <StockTableSkeleton />
        ) : (
          <VirtualStockList stocks={filtered} onStockSelect={selectStock} />
        )}
      </div>

      <div className="text-xs font-mono text-ex-dim text-right">共 {stocks.length} 支股票，当前显示 {filtered.length} 支</div>
    </div>
  )
}
