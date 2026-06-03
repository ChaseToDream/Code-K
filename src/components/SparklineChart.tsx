import { useEffect, useRef } from 'react'
import { createChart, AreaSeries } from 'lightweight-charts'
import type { IChartApi, Time } from 'lightweight-charts'
import type { CandleData } from '../lib/types'

interface SparklineChartProps {
  candles: CandleData[]
  width?: number
  height?: number
}

export default function SparklineChart({ candles, width = 120, height = 32 }: SparklineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return

    const container = containerRef.current

    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: 'transparent',
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: { mode: 1 },
      timeScale: { visible: false },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      handleScroll: false,
      handleScale: false,
    })

    chartRef.current = chart

    const isUp = candles[candles.length - 1].close >= candles[0].open
    const color = isUp ? '#00e676' : '#ff1744'

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: color,
      lineWidth: 1,
      topColor: isUp ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 23, 68, 0.15)',
      bottomColor: 'transparent',
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    })

    const data = candles.map((c) => ({
      time: c.time as Time,
      value: c.close,
    }))

    areaSeries.setData(data)
    chart.timeScale().fitContent()

    return () => {
      chart.remove()
      chartRef.current = null
    }
  }, [candles, width, height])

  return <div ref={containerRef} style={{ width, height }} />
}
