import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import SparklineChart from './SparklineChart'
import type { FileStock } from '../lib/types'

interface VirtualStockListProps {
  stocks: FileStock[]
  /** 是否有激活的筛选条件（决定空状态文案与是否显示清除按钮） */
  hasActiveFilter?: boolean
  /** 清除筛选回调（hasActiveFilter 时空状态显示清除按钮） */
  onClearFilter?: () => void
}

const ROW_HEIGHT = 64
const HEADER_HEIGHT = 45
const OVERSCAN = 3 // 上下额外渲染的行数，减少白屏

const STATUS_LABELS: Record<FileStock['status'], string> = {
  active: '上市中',
  ipo: '新上市',
  delisted: '已退市',
}

/**
 * 简单虚拟滚动列表
 * 只渲染可视区域内的行，避免千行 DOM 爆炸
 * 高度自我测量：最外层 flex-1，ResizeObserver 观察自身（父容器给定明确高度）
 */
export default function VirtualStockList({ stocks, hasActiveFilter = false, onClearFilter }: VirtualStockListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [measuredHeight, setMeasuredHeight] = useState(0)
  const scrollRafRef = useRef<number | null>(null)

  // ResizeObserver 观察容器自身尺寸（初始即回调一次）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      setMeasuredHeight(el.clientHeight)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 卸载时取消未执行的滚动帧
  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  const totalHeight = stocks.length * ROW_HEIGHT
  // 测量完成前退回内容高度（上限 640），测量完成后用真实可视高度
  const scrollAreaHeight = measuredHeight > 0
    ? Math.max(0, measuredHeight - HEADER_HEIGHT)
    : Math.min(totalHeight, 640)

  // 计算可视范围
  const visibleRange = useMemo(() => {
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(scrollAreaHeight / ROW_HEIGHT) + OVERSCAN * 2
    const endIdx = Math.min(stocks.length, startIdx + visibleCount)
    return { startIdx, endIdx }
  }, [scrollTop, scrollAreaHeight, stocks.length])

  // requestAnimationFrame 节流：滚动事件每帧最多触发一次状态更新
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const nextScrollTop = e.currentTarget.scrollTop
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      setScrollTop(nextScrollTop)
    })
  }, [])

  if (stocks.length === 0) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center gap-3 py-12 min-h-0">
        <p className="text-ex-dim text-sm font-mono">
          {hasActiveFilter ? '没有匹配的股票' : '暂无数据'}
        </p>
        {hasActiveFilter && onClearFilter && (
          <button
            onClick={onClearFilter}
            className="px-3 py-1.5 text-xs font-mono bg-ex-panel border border-ex-border rounded
              text-ex-dim hover:text-ex-accent hover:border-ex-accent/40 transition-colors cursor-pointer"
          >
            清除筛选
          </button>
        )}
      </div>
    )
  }

  const { startIdx, endIdx } = visibleRange
  const visibleStocks = stocks.slice(startIdx, endIdx)
  const offsetY = startIdx * ROW_HEIGHT

  return (
    <div ref={containerRef} className="flex-1 h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="grid grid-cols-[2fr_80px_100px_100px_100px_140px] gap-4 px-6 py-3 border-b border-ex-border text-xs font-mono text-ex-dim shrink-0">
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
        style={{ height: Math.min(totalHeight, scrollAreaHeight) }}
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleStocks.map((stock) => {
              const candleUp = stock.changePercent >= 0
              const statusLabel = STATUS_LABELS[stock.status]
              return (
                <Link
                  key={stock.path}
                  to={`/stock/${encodeURIComponent(stock.path)}`}
                  className="grid grid-cols-[2fr_80px_100px_100px_100px_140px] gap-4 px-6 py-3 hover:bg-ex-panel/50 transition-colors no-underline items-center border-b border-ex-border/30"
                  style={{ height: ROW_HEIGHT }}
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
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${stock.status === 'active' ? 'bg-ex-green' : stock.status === 'ipo' ? 'bg-ex-gold' : 'bg-ex-dim'}`}
                      title={statusLabel}
                    >
                      <span className="sr-only">{statusLabel}</span>
                    </span>
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
