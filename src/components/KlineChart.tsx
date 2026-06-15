import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, CandlestickData, HistogramData, Time } from 'lightweight-charts'
import type { FileStock } from '../lib/types'

interface KlineChartProps {
  stock: FileStock
}

/** 影线（上下影线）样式配置 —— 与 K 线主体配色一致，使用实色确保影线清晰可辨 */
const WICK_STYLE = {
  upColor: '#00e676',
  downColor: '#ff1744',
} as const

/**
 * 固定的 K 线宽度（相邻蜡烛中心间距，像素）。
 * 固定后不再随容器宽度重算：数据少时不被拉伸，屏幕宽度变化时单根 K 线宽度保持一致。
 * 滚轮缩放仍可临时改变可见比例（lightweight-charts 内置），但不回写此默认值。
 */
export const FIXED_BAR_SPACING = 12

export default function KlineChart({ stock }: KlineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  // 初始化图表（只执行一次）
  useEffect(() => {
    if (!chartContainerRef.current || chartRef.current) return

    const container = chartContainerRef.current

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
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
        rightOffset: 2,
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
    candleSeriesRef.current = candleSeries

    // Volume series (histogram at bottom)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    volumeSeriesRef.current = volumeSeries

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    // Resize handler —— 仅更新容器宽度，不重算 barSpacing（保持 K 线固定宽度）
    const handleResize = () => {
      if (!chartContainerRef.current || !chartRef.current) return
      const newWidth = chartContainerRef.current.clientWidth
      chartRef.current.applyOptions({ width: newWidth })
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      chartRef.current = null
      chart.remove()
    }
  }, [])

  // 数据更新：stock 变化时复用 chart 实例，仅更新 series 数据
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return

    const candleData: CandlestickData[] = stock.candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))
    candleSeriesRef.current.setData(candleData)

    const volumeData: HistogramData[] = stock.candles.map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 23, 68, 0.2)',
    }))
    volumeSeriesRef.current.setData(volumeData)

    // 保持固定宽度：用 scrollToRealTime 对齐到右端，而非 fitContent（后者会把数据拉伸到容器宽度）
    chartRef.current.timeScale().scrollToRealTime()
  }, [stock])

  return (
    <div className="w-full">
      <div ref={chartContainerRef} className="w-full" />
    </div>
  )
}
