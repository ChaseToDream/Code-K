import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { IChartApi } from 'lightweight-charts'
import { useRepo } from '../hooks/useRepo'
import { useWebSocket } from '../hooks/useWebSocket'
import KlineChart from '../components/KlineChart'
import DiffViewer from '../components/DiffViewer'
import FileTree from '../components/FileTree'
import ErrorBoundary from '../components/ErrorBoundary'
import { ChartSkeleton } from '../components/Skeleton'
import { exportChartAsPNG, exportStockDetails } from '../lib/export'

interface RemoteDiffState {
  commitHash: string
  filePath: string
  oldContent: string | null
  newContent: string | null
  additions: number
  deletions: number
  isBinary?: boolean
}

// YY/MM/DD 短日期格式
function formatShortDate(timestamp: number): string {
  const d = new Date(timestamp * 1000)
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}/${mm}/${dd}`
}

export default function StockDetail() {
  const { path } = useParams<{ path: string }>()
  const decodedPath = decodeURIComponent(path || '')
  const { activeRepo, activeRepoId, refreshRepo } = useRepo()
  const { sendRequestDiff, onDiffDetail } = useWebSocket()

  const stock = useMemo(
    () => activeRepo?.stocks.find(s => s.path === decodedPath),
    [activeRepo, decodedPath]
  )

  const [selectedCandle, setSelectedCandle] = useState<number | null>(null)
  const [showFileTree, setShowFileTree] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [chartApi, setChartApi] = useState<IChartApi | null>(null)
  const [remoteDiff, setRemoteDiff] = useState<RemoteDiffState | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 当前等待响应的 diff 请求（后端模式），用 ref 供订阅回调读取
  const pendingDiffRef = useRef<{ commitHash: string; filePath: string } | null>(null)

  const isParsing = activeRepo?.status === 'parsing'

  // 订阅后端 diff 响应：只接收当前 pending 的 commitHash + filePath
  useEffect(() => {
    const unsubscribe = onDiffDetail((detail) => {
      const pending = pendingDiffRef.current
      if (!pending) return
      if (detail.commitHash !== pending.commitHash || detail.filePath !== pending.filePath) return

      pendingDiffRef.current = null
      setDiffLoading(false)
      if (detail.error) {
        setDiffError(detail.error)
        setRemoteDiff(null)
      } else {
        setDiffError(null)
        setRemoteDiff({
          commitHash: detail.commitHash,
          filePath: detail.filePath,
          oldContent: detail.oldContent,
          newContent: detail.newContent,
          additions: detail.additions,
          deletions: detail.deletions,
          isBinary: detail.isBinary,
        })
      }
    })
    return unsubscribe
  }, [onDiffDetail])

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
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current)
    refreshTimeoutRef.current = setTimeout(() => setIsRefreshing(false), 3000)
  }

  const resetDiffState = () => {
    setRemoteDiff(null)
    setDiffError(null)
    setDiffLoading(false)
    pendingDiffRef.current = null
  }

  const handleViewDiff = (candleIdx: number) => {
    if (!stock || !activeRepo) return
    const candle = stock.candles[candleIdx]
    if (!candle) return

    // 切换 commit 时重置旧 diff 状态
    resetDiffState()
    setSelectedCandle(candleIdx)

    // 本地解析模式：candle 自带内容，直接渲染
    if (candle.oldContent !== undefined) return

    // 后端模式：通过 WebSocket 请求 diff 内容
    setDiffLoading(true)
    pendingDiffRef.current = { commitHash: candle.commitHash, filePath: stock.path }
    sendRequestDiff(activeRepo.path, candle.commitHash, stock.path)
  }

  const handleCloseDiff = useCallback(() => {
    setSelectedCandle(null)
    setRemoteDiff(null)
    setDiffError(null)
    setDiffLoading(false)
    pendingDiffRef.current = null
  }, [])

  const handleToggleFileTree = useCallback(() => {
    setShowFileTree(prev => !prev)
  }, [])

  const handleExportChart = useCallback(() => {
    exportChartAsPNG(chartApi, `${stock?.ticker || 'chart'}.png`)
  }, [chartApi, stock])

  const handleExportDetails = useCallback(() => {
    if (stock) {
      exportStockDetails(stock)
    }
  }, [stock])

  // memo 化 high/low，避免每次渲染重复遍历（必须在 early return 之前调用）
  const { high, low } = useMemo(() => {
    if (!stock || stock.candles.length === 0) return { high: 0, low: 0 }
    let h = stock.candles[0].high
    let l = stock.candles[0].low
    for (let i = 1; i < stock.candles.length; i++) {
      const c = stock.candles[i]
      if (c.high > h) h = c.high
      if (c.low < l) l = c.low
    }
    return { high: h, low: l }
  }, [stock])

  // memo 化倒序提交历史（必须在 early return 之前调用）
  const reversedCandles = useMemo(
    () => (stock ? [...stock.candles].reverse() : []),
    [stock]
  )

  if (!stock) {
    // 仓库仍在解析时显示骨架屏，而非"未找到"
    if (activeRepo?.status === 'parsing') {
      return (
        <div className="h-full p-6 max-w-7xl mx-auto space-y-4">
          <ChartSkeleton />
          <p className="text-center text-ex-dim text-sm font-mono">正在解析仓库...</p>
        </div>
      )
    }
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-ex-dim text-lg">未找到该文件: {decodedPath}</p>
          <Link to="/market" className="text-ex-accent text-sm hover:underline">
            返回行情页
          </Link>
        </div>
      </div>
    )
  }

  const isUp = stock.changePercent >= 0
  const totalVolume = stock.totalAdditions + stock.totalDeletions
  const firstDate = stock.firstCommit
    ? new Date(stock.firstCommit.timestamp * 1000).toLocaleDateString()
    : '-'
  const lastDate = stock.lastCommit
    ? new Date(stock.lastCommit.timestamp * 1000).toLocaleDateString()
    : '-'
  const firstDateShort = stock.firstCommit ? formatShortDate(stock.firstCommit.timestamp) : '-'
  const lastDateShort = stock.lastCommit ? formatShortDate(stock.lastCommit.timestamp) : '-'

  const selectedCandleData = selectedCandle !== null ? stock.candles[selectedCandle] : null

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        {/* Stock Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Link to="/market" aria-label="返回行情页" className="text-ex-dim hover:text-ex-text transition-colors no-underline">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="font-[Orbitron] text-2xl font-bold text-ex-heading tracking-wider">
                {stock.ticker}
              </h1>
              {stock.status === 'ipo' && (
                <span className="px-2 py-1 text-xs font-mono font-bold bg-ex-gold/15 text-ex-gold rounded glow-gold">
                  IPO
                </span>
              )}
              {stock.status === 'delisted' && (
                <span className="px-2 py-1 text-xs font-mono font-bold bg-ex-dim/20 text-ex-dim rounded">
                  DELISTED
                </span>
              )}
              {stock.status === 'active' && (
                <span className="px-2 py-1 text-xs font-mono font-bold bg-ex-green/15 text-ex-green rounded">
                  ACTIVE
                </span>
              )}
              <button
                onClick={handleToggleFileTree}
                className={`px-2 py-1 text-xs font-mono rounded transition-colors cursor-pointer
                  ${showFileTree ? 'bg-ex-accent/20 text-ex-accent' : 'bg-ex-surface text-ex-dim hover:text-ex-text'}`}
              >
                文件树
              </button>
              <button
                onClick={handleRefresh}
                disabled={isParsing || isRefreshing}
                className={`px-2 py-1 text-xs font-mono rounded transition-colors cursor-pointer flex items-center gap-1
                  ${isParsing || isRefreshing
                    ? 'bg-ex-surface text-ex-dim cursor-not-allowed'
                    : 'bg-ex-surface text-ex-dim hover:text-ex-accent'
                  }`}
                title="刷新仓库数据"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${isRefreshing ? 'animate-spin' : ''}`}>
                  <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
                {isRefreshing ? '刷新中' : '刷新'}
              </button>
            </div>
            <p className="text-sm text-ex-dim font-mono pl-8">{stock.path}</p>
          </div>

          <div className="text-right space-y-1">
            <div className="font-mono text-3xl font-bold text-ex-heading">
              {stock.currentLines.toLocaleString()}
              <span className="text-sm text-ex-dim ml-2">lines</span>
            </div>
            <div className={`font-mono text-lg font-semibold ${isUp ? 'text-ex-green glow-green' : 'text-ex-red glow-red'}`}>
              {isUp ? '+' : ''}{stock.changePercent.toFixed(2)}%
              <span className={`text-xs ml-2 ${isUp ? 'text-ex-green/60' : 'text-ex-red/60'}`}>
                {isUp ? 'BULLISH' : 'BEARISH'}
              </span>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'OPEN', value: stock.candles[0]?.open.toLocaleString() || '0' },
            { label: 'HIGH', value: high.toLocaleString() },
            { label: 'LOW', value: low.toLocaleString() },
            { label: 'VOLUME', value: totalVolume.toLocaleString() },
            { label: 'TRADES', value: stock.candles.length.toString() },
            { label: 'LISTED', value: `${firstDateShort} - ${lastDateShort}`, title: `${firstDate} - ${lastDate}` },
          ].map((stat) => (
            <div key={stat.label} className="bg-ex-surface border border-ex-border rounded-lg p-3">
              <div className="text-[10px] text-ex-dim font-mono mb-0.5">{stat.label}</div>
              <div className="text-sm font-mono text-ex-heading truncate" title={stat.title}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* K-Line Chart */}
        <div className="bg-ex-surface border border-ex-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-ex-dim uppercase">Candlestick Chart</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-ex-dim">{stock.candles.length} candles</span>
              <button
                onClick={handleExportChart}
                className="px-2 py-1 text-xs font-mono bg-ex-panel border border-ex-border rounded text-ex-dim hover:text-ex-text transition-colors cursor-pointer"
                title="导出为PNG"
              >
                导出PNG
              </button>
              <button
                onClick={handleExportDetails}
                className="px-2 py-1 text-xs font-mono bg-ex-panel border border-ex-border rounded text-ex-dim hover:text-ex-text transition-colors cursor-pointer"
                title="导出详细数据"
              >
                导出JSON
              </button>
            </div>
          </div>
          <ErrorBoundary
            fallback={
              <div className="p-8 text-center">
                <p className="text-ex-red text-sm font-mono">图表渲染失败</p>
              </div>
            }
          >
            <KlineChart stock={stock} onChartReady={setChartApi} />
          </ErrorBoundary>
        </div>

        {/* Diff Viewer */}
        {selectedCandleData && (
          <div className="space-y-2">
            <h3 className="text-sm font-mono text-ex-heading">
              提交差异详情 - {selectedCandleData.commitHash}
            </h3>
            {diffError ? (
              <div className="bg-ex-red/10 border border-ex-red/30 rounded-lg px-4 py-3 text-ex-red text-sm font-mono">
                {diffError}
              </div>
            ) : selectedCandleData.oldContent !== undefined ? (
              // 本地解析模式：candle 自带内容
              <DiffViewer
                fileName={stock.path}
                commitHash={selectedCandleData.commitHash}
                oldContent={selectedCandleData.oldContent ?? null}
                newContent={selectedCandleData.newContent ?? null}
                additions={selectedCandleData.additions}
                deletions={selectedCandleData.deletions}
                onClose={handleCloseDiff}
              />
            ) : diffLoading ? (
              // 后端模式：等待 WebSocket 返回 diff 内容
              <div className="bg-ex-surface border border-ex-border rounded-lg p-8 text-center">
                <p className="text-ex-dim text-sm font-mono">加载 diff...</p>
              </div>
            ) : remoteDiff && remoteDiff.commitHash === selectedCandleData.commitHash ? (
              // 后端模式：响应已到达
              <DiffViewer
                fileName={stock.path}
                commitHash={selectedCandleData.commitHash}
                oldContent={remoteDiff.oldContent}
                newContent={remoteDiff.newContent}
                additions={remoteDiff.additions}
                deletions={remoteDiff.deletions}
                isBinary={remoteDiff.isBinary}
                onClose={handleCloseDiff}
              />
            ) : null}
          </div>
        )}

        {/* Commit History */}
        <div className="bg-ex-surface border border-ex-border rounded-lg overflow-hidden">
          <div className="px-6 py-3 border-b border-ex-border">
            <span className="text-xs font-mono text-ex-dim uppercase">Recent Trades (Commits)</span>
          </div>
          <div className="divide-y divide-ex-border/50 max-h-80 overflow-y-auto">
            {reversedCandles.map((candle, i) => {
              const candleUp = candle.close >= candle.open
              const originalIdx = stock.candles.length - 1 - i
              const isSelected = selectedCandle === originalIdx

              return (
                <div
                  key={i}
                  className={`px-6 py-3 flex items-center justify-between transition-colors cursor-pointer
                    ${isSelected ? 'bg-ex-accent/10' : 'hover:bg-ex-panel/50'}`}
                  onClick={() => handleViewDiff(originalIdx)}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-1.5 h-8 rounded-full ${candleUp ? 'bg-ex-green' : 'bg-ex-red'}`} />
                    <div className="min-w-0">
                      <p className="text-sm text-ex-heading truncate max-w-lg">{candle.commitMessage}</p>
                      <p className="text-xs text-ex-dim font-mono">
                        {candle.author} &middot; {new Date(candle.time * 1000).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right font-mono text-xs shrink-0 ml-4">
                    <div className="text-ex-heading">
                      {candle.open} &rarr; {candle.close}
                    </div>
                    <div>
                      <span className="text-ex-green">+{candle.additions}</span>{' '}
                      <span className="text-ex-red">-{candle.deletions}</span>{' '}
                      <span className="text-ex-dim">({candle.volume} vol)</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* File Tree Sidebar */}
      {showFileTree && activeRepo && (
        <div className="w-80 border-l border-ex-border p-4 overflow-auto">
          <FileTree stocks={activeRepo.stocks} activePath={stock.path} />
        </div>
      )}
    </div>
  )
}
