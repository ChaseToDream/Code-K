import { useCallback, useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, CandlestickData, HistogramData, Time } from 'lightweight-charts'
import type { IndexCandle } from '../hooks/useMarketIndex'
import { CHART_COLORS, FIXED_BAR_SPACING, WICK_STYLE } from '../lib/chart-config'

interface MarketIndexChartProps {
  candles: IndexCandle[]
}

/**
 * 综合指数 K 线图组件
 * 初始化一次 + series.setData 增量更新，数据刷新不丢失用户缩放状态
 */
export default function MarketIndexChart({ candles }: MarketIndexChartProps) {
  // 回调 ref：容器挂载/卸载时触发（空数据时渲染占位、不渲染容器）
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const prevDataLenRef = useRef(0)
  const candlesRef = useRef(candles)

  useEffect(() => {
    candlesRef.current = candles
  }, [candles])

  // 初始化图表（容器存在期间只执行一次）
  useEffect(() => {
    if (!container || chartRef.current) return

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
      upColor: CHART_COLORS.up,
      downColor: CHART_COLORS.down,
      borderUpColor: CHART_COLORS.up,
      borderDownColor: CHART_COLORS.down,
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

    // 容器晚于数据到达时（空数据 → 有数据），初始化时补写一次数据并对齐右端
    const initial = candlesRef.current
    if (initial.length > 0) {
      candleSeries.setData(initial.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })))
      volumeSeries.setData(initial.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? CHART_COLORS.upVolume : CHART_COLORS.downVolume,
      })))
      prevDataLenRef.current = initial.length
      chart.timeScale().scrollToRealTime()
    }

    // Resize handler —— 仅更新容器宽度，不重算 barSpacing（保持 K 线固定宽度）
    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth })
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      chartRef.current = null
      chart.remove()
    }
  }, [container])

  // 数据更新：candles 变化时复用 chart 实例，仅更新 series 数据（保留用户缩放）
  useEffect(() => {
    // 仅初始加载（数据从 0 变为 >0）时对齐到右端；后续增量更新不打扰用户视口
    const hadData = prevDataLenRef.current > 0
    prevDataLenRef.current = candles.length

    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return

    const candleData: CandlestickData[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))
    candleSeriesRef.current.setData(candleData)

    const volumeData: HistogramData[] = candles.map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? CHART_COLORS.upVolume : CHART_COLORS.downVolume,
    }))
    volumeSeriesRef.current.setData(volumeData)

    if (!hadData && candles.length > 0) {
      chartRef.current.timeScale().scrollToRealTime()
    }
  }, [candles])

  const handleContainerRef = useCallback((el: HTMLDivElement | null) => {
    setContainer(el)
  }, [])

  if (candles.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center bg-ex-surface/50 rounded-lg border border-ex-border">
        <span className="text-ex-dim text-sm font-mono">暂无指数数据</span>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div ref={handleContainerRef} className="w-full" />
    </div>
  )
}
