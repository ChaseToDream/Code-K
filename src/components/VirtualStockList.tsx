import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import SparklineChart from './SparklineChart'
import type { FileStock } from '../lib/types'

interface VirtualStockListProps {
  stocks: FileStock[]
  onStockSelect: (stock: FileStock) => void
}

const ROW_HEIGHT = 64
const HEADER_HEIGHT = 45
const OVERSCAN = 3 // 上下额外渲染的行数，减少白屏

/**
 * 简单虚拟滚动列表
 * 只渲染可视区域内的行，避免千行 DOM 爆炸
 */
export default function VirtualStockList({ stocks, onStockSelect }: VirtualStockListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  // 监听容器尺寸变化
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const updateHeight = () => {
      const parent = el.parentElement
      if (parent) {
        setContainerHeight(parent.clientHeight - HEADER_HEIGHT)
      }
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  const totalHeight = stocks.length * ROW_HEIGHT

  // 计算可视范围
  const visibleRange = useMemo(() => {
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + OVERSCAN * 2
    const endIdx = Math.min(stocks.length, startIdx + visibleCount)
    return { startIdx, endIdx }
  }, [scrollTop, containerHeight, stocks.length])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  if (stocks.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-ex-dim text-sm font-mono">暂无匹配的股票</p>
      </div>
    )
  }

  const { startIdx, endIdx } = visibleRange
  const visibleStocks = stocks.slice(startIdx, endIdx)
  const offsetY = startIdx * ROW_HEIGHT

  return (
    <div ref={containerRef}>
      {/* Header */}
      <div className="grid grid-cols-[2fr_80px_100px_100px_100px_140px] gap-4 px-6 py-3 border-b border-ex-border text-xs font-mono text-ex-dim">
        <span>文件</span>
        <span className="text-right">状态</span>
        <span className="text-right">行数</span>
        <span className="text-right">涨跌</span>
        <span className="text-right">成交量</span>
        <span className="text-right">走势</span>
      </div>

      {/* Virtual scroll container */}
      <div
        className="overflow-y-auto"
        style={{ height: Math.min(totalHeight, containerHeight || 640) }}
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleStocks.map((stock, i) => {
              const actualIdx = startIdx + i
              const candleUp = stock.changePercent >= 0
              return (
                <Link
                  key={stock.path}
                  to={`/stock/${encodeURIComponent(stock.path)}`}
                  onClick={() => onStockSelect(stock)}
                  className="grid grid-cols-[2fr_80px_100px_100px_100px_140px] gap-4 px-6 py-3 hover:bg-ex-panel/50 transition-colors no-underline items-center border-b border-ex-border/30"
                  style={{ height: ROW_HEIGHT }}
                  data-index={actualIdx}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-ex-heading truncate">{stock.ticker}</span>
                      {stock.status === 'ipo' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-ex-gold/15 text-ex-gold rounded glow-gold">新股</span>
                      )}
                      {stock.status === 'delisted' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-ex-dim/15 text-ex-dim rounded">退市</span>
                      )}
                    </div>
                    <span className="text-xs text-ex-dim truncate">{stock.path}</span>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block w-2 h-2 rounded-full ${stock.status === 'active' ? 'bg-ex-green' : stock.status === 'ipo' ? 'bg-ex-gold' : 'bg-ex-dim'}`} />
                  </div>
                  <div className="text-right font-mono text-sm text-ex-heading">{stock.currentLines.toLocaleString()}</div>
                  <div className={`text-right font-mono text-sm font-semibold ${candleUp ? 'text-ex-green glow-green' : 'text-ex-red glow-red'}`}>
                    {candleUp ? '+' : ''}{stock.changePercent.toFixed(2)}%
                  </div>
                  <div className="text-right font-mono text-sm text-ex-text">
                    {(stock.totalAdditions + stock.totalDeletions).toLocaleString()}
                  </div>
                  <div className="flex justify-end">
                    <SparklineChart candles={stock.candles} width={120} height={32} />
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
