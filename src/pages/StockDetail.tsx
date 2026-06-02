import { useMemo, useState, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useRepo } from '../hooks/useRepo'
import KlineChart from '../components/KlineChart'
import DiffViewer from '../components/DiffViewer'
import FileTree from '../components/FileTree'
import { exportChartToPNG, exportStockDetails } from '../lib/export'

export default function StockDetail() {
  const { path } = useParams<{ path: string }>()
  const decodedPath = decodeURIComponent(path || '')
  const { activeRepo, selectStock } = useRepo()

  const stock = useMemo(
    () => activeRepo?.stocks.find(s => s.path === decodedPath),
    [activeRepo, decodedPath]
  )

  const [selectedCandle, setSelectedCandle] = useState<number | null>(null)
  const [showFileTree, setShowFileTree] = useState(false)
  const chartContainerRef = useRef<HTMLDivElement>(null)

  const handleViewDiff = useCallback((candleIdx: number) => {
    setSelectedCandle(candleIdx)
  }, [])

  const handleCloseDiff = useCallback(() => {
    setSelectedCandle(null)
  }, [])

  const handleToggleFileTree = useCallback(() => {
    setShowFileTree(prev => !prev)
  }, [])

  const handleExportChart = useCallback(() => {
    if (chartContainerRef.current) {
      exportChartToPNG(chartContainerRef.current, `${stock?.ticker || 'chart'}.png`)
    }
  }, [stock])

  const handleExportDetails = useCallback(() => {
    if (stock) {
      exportStockDetails(stock)
    }
  }, [stock])

  if (!stock) {
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

  const selectedCandleData = selectedCandle !== null ? stock.candles[selectedCandle] : null

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        {/* Stock Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Link to="/market" className="text-ex-dim hover:text-ex-text transition-colors no-underline">
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
        <div className="grid grid-cols-6 gap-4">
          {[
            { label: 'OPEN', value: stock.candles[0]?.open.toLocaleString() || '0' },
            { label: 'HIGH', value: Math.max(...stock.candles.map(c => c.high)).toLocaleString() },
            { label: 'LOW', value: Math.min(...stock.candles.map(c => c.low)).toLocaleString() },
            { label: 'VOLUME', value: totalVolume.toLocaleString() },
            { label: 'TRADES', value: stock.candles.length.toString() },
            { label: 'LISTED', value: `${firstDate} - ${lastDate}` },
          ].map((stat) => (
            <div key={stat.label} className="bg-ex-surface border border-ex-border rounded-lg p-3">
              <div className="text-[10px] text-ex-dim font-mono mb-0.5">{stat.label}</div>
              <div className="text-sm font-mono text-ex-heading">{stat.value}</div>
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
          <div ref={chartContainerRef}>
            <KlineChart stock={stock} />
          </div>
        </div>

        {/* Diff Viewer */}
        {selectedCandleData && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-mono text-ex-heading">
                提交差异详情 - {selectedCandleData.commitHash}
              </h3>
              <button
                onClick={handleCloseDiff}
                className="text-ex-dim hover:text-ex-red transition-colors text-sm font-mono cursor-pointer"
              >
                关闭
              </button>
            </div>
            {selectedCandleData.oldContent !== undefined && selectedCandleData.newContent !== undefined ? (
              <DiffViewer
                oldContent={selectedCandleData.oldContent}
                newContent={selectedCandleData.newContent}
                filePath={stock.path}
                additions={Math.max(0, selectedCandleData.close - selectedCandleData.open)}
                deletions={Math.max(0, selectedCandleData.open - selectedCandleData.close)}
                onClose={handleCloseDiff}
              />
            ) : (
              <div className="bg-ex-surface border border-ex-border rounded-lg p-8 text-center">
                <p className="text-ex-dim text-sm font-mono">此提交没有文件内容数据</p>
              </div>
            )}
          </div>
        )}

        {/* Commit History */}
        <div className="bg-ex-surface border border-ex-border rounded-lg overflow-hidden">
          <div className="px-6 py-3 border-b border-ex-border">
            <span className="text-xs font-mono text-ex-dim uppercase">Recent Trades (Commits)</span>
          </div>
          <div className="divide-y divide-ex-border/50 max-h-80 overflow-y-auto">
            {[...stock.candles].reverse().map((candle, i) => {
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
                    <div className={candleUp ? 'text-ex-green' : 'text-ex-red'}>
                      {candleUp ? '+' : ''}{candle.close - candle.open} ({candle.volume} vol)
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
          <FileTree stocks={activeRepo.stocks} onStockSelect={selectStock} />
        </div>
      )}
    </div>
  )
}
