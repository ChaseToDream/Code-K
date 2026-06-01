import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import type { IChartApi, CandlestickData, HistogramData, Time } from 'lightweight-charts'
import type { FileStock } from '../lib/types'

interface KlineChartProps {
  stock: FileStock
}

export default function KlineChart({ stock }: KlineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    const container = chartContainerRef.current

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
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
      },
      rightPriceScale: {
        borderColor: '#1e293b',
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

    // Resize handler
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
  }, [stock])

  return <div ref={chartContainerRef} className="w-full" />
}
