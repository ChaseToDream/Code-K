import { useEffect, useRef, useMemo, useCallback } from 'react'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import type { IChartApi, CandlestickData, HistogramData, Time } from 'lightweight-charts'
import type { FileStock } from '../lib/types'

interface KlineChartProps {
  stock: FileStock
}

/** 默认可见 K 线数量 */
const TARGET_VISIBLE_CANDLES = 100
/** 最小单条 K 线宽度（像素） */
const MIN_CANDLE_WIDTH = 2
/** 最小 K 线间距（像素） */
const MIN_CANDLE_GAP = 1

export default function KlineChart({ stock }: KlineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  /**
   * 根据容器宽度计算合适的 barSpacing，使默认可见区域恰好容纳 TARGET_VISIBLE_CANDLES 条 K 线
   *
   * lightweight-charts 的 timeScale 中：
   * - barSpacing = 单根 K 线占据的总宽度（含间距）
   * - 可见区域宽度 ≈ containerWidth - rightPriceScaleWidth
   * - 默认 fitContent 后，可见 K 线数 ≈ visibleWidth / barSpacing
   *
   * 因此 barSpacing = visibleWidth / TARGET_VISIBLE_CANDLES
   */
  const computeBarSpacing = useCallback((containerWidth: number): number => {
    // 右侧价格轴大致宽度（lightweight-charts 默认约 50~70px，取保守值）
    const rightPriceScaleWidth = 60
    const visibleWidth = Math.max(200, containerWidth - rightPriceScaleWidth)
    const spacing = visibleWidth / TARGET_VISIBLE_CANDLES
    // 保证单根 K 线至少有 MIN_CANDLE_WIDTH 的实体 + MIN_CANDLE_GAP 的间隙
    return Math.max(spacing, MIN_CANDLE_WIDTH + MIN_CANDLE_GAP)
  }, [])

  /** 内容宽度固定按 100 根 K 线计算，与实际数据量无关 */
  const contentWidth = useMemo(() => {
    const barSpacing = computeBarSpacing(800)
    return TARGET_VISIBLE_CANDLES * barSpacing
  }, [computeBarSpacing])

  useEffect(() => {
    if (!chartContainerRef.current) return

    const container = chartContainerRef.current
    const initialBarSpacing = computeBarSpacing(container.clientWidth)

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
        barSpacing: initialBarSpacing,
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
      wickUpColor: '#00e67680',
      wickDownColor: '#ff174480',
    })

    const candleData: CandlestickData[] = stock.candles.map((c) => ({
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

    const volumeData: HistogramData[] = stock.candles.map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 23, 68, 0.2)',
    }))

    volumeSeries.setData(volumeData)

    // Fit content
    chart.timeScale().fitContent()

    // Resize handler：窗口变化时重新计算 barSpacing，保持 100 条 K 线可见
    const handleResize = () => {
      if (!chartContainerRef.current) return
      const newWidth = chartContainerRef.current.clientWidth
      const newBarSpacing = computeBarSpacing(newWidth)
      chart.applyOptions({
        width: newWidth,
        timeScale: { barSpacing: newBarSpacing },
      })
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [stock, computeBarSpacing])

  return (
    <div className="w-full">
      <div ref={chartContainerRef} className="w-full" style={{ minWidth: contentWidth }} />
    </div>
  )
}
