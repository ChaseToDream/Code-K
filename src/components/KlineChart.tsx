import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, CandlestickData, HistogramData, Time } from 'lightweight-charts'
import type { FileStock } from '../lib/types'
import { CHART_COLORS, FIXED_BAR_SPACING, WICK_STYLE } from '../lib/chart-config'

interface KlineChartProps {
  stock: FileStock
  /** 图表初始化完成后回调一次（用于导出、外部联动等） */
  onChartReady?: (api: IChartApi) => void
}

export default function KlineChart({ stock, onChartReady }: KlineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const onChartReadyRef = useRef(onChartReady)

  useEffect(() => {
    onChartReadyRef.current = onChartReady
  }, [onChartReady])

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

    // 观察容器自身尺寸变化（侧栏开合、窗口缩放都会触发），仅更新宽度，不重算 barSpacing
    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return
      const newWidth = chartContainerRef.current.clientWidth
      chartRef.current.applyOptions({ width: newWidth })
    })
    resizeObserver.observe(container)

    onChartReadyRef.current?.(chart)

    return () => {
      resizeObserver.disconnect()
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
      color: c.close >= c.open ? CHART_COLORS.upVolume : CHART_COLORS.downVolume,
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
