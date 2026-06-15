import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import type { IChartApi, CandlestickData, HistogramData, Time } from 'lightweight-charts'
import type { IndexCandle } from '../hooks/useMarketIndex'
import { FIXED_BAR_SPACING, WICK_STYLE } from '../lib/chart-config'

interface MarketIndexChartProps {
  candles: IndexCandle[]
}

/**
 * 综合指数 K 线图组件
 */
export default function MarketIndexChart({ candles }: MarketIndexChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return

    const container = chartContainerRef.current

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 320,
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.5)' },
        horzLines: { color: 'rgba(30, 41, 59, 0.5)' },
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: 'rgba(59, 130, 246, 0.3)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: 'rgba(59, 130, 246, 0.3)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e293b',
        },
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: FIXED_BAR_SPACING,
        rightOffset: 4,
        fixLeftEdge: true,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        visible: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
      leftPriceScale: {
        visible: false,
      },
      handleScroll: {
        horzTouchDrag: true,
        vertTouchDrag: false,
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: false,
        },
        mouseWheel: true,
        pinch: true,
      },
    })

    chartRef.current = chart

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00e676',
      downColor: '#ff1744',
      borderUpColor: '#00e676',
      borderDownColor: '#ff1744',
      wickUpColor: WICK_STYLE.upColor,
      wickDownColor: WICK_STYLE.downColor,
    })

    const candleData: CandlestickData[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    candleSeries.setData(candleData)

    // Volume series (histogram at bottom)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    const volumeData: HistogramData[] = candles.map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 23, 68, 0.2)',
    }))

    volumeSeries.setData(volumeData)

    // 保持固定宽度：对齐到右端，而非 fitContent（后者会把数据拉伸到容器宽度）
    chart.timeScale().scrollToRealTime()

    // Resize handler —— 仅更新容器宽度，不重算 barSpacing（保持 K 线固定宽度）
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [candles])

  if (candles.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center bg-ex-surface/50 rounded-lg border border-ex-border">
        <span className="text-ex-dim text-sm font-mono">暂无指数数据</span>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div ref={chartContainerRef} className="w-full" />
    </div>
  )
}
