import { useEffect, useRef, useMemo } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
} from 'lightweight-charts'
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  Time,
  DeepPartial,
  ChartOptions,
} from 'lightweight-charts'
import type { FileStock } from '../lib/types'
import { FIXED_BAR_SPACING, WICK_STYLE } from '../lib/chart-config'
import { sma, macd, rsi, boll } from '../lib/indicators'
import type { IndicatorPoint, MACDPoint, BOLLPoint } from '../lib/indicators'

export interface IndicatorConfig {
  ma: { enabled: boolean; periods: number[] }
  boll: boolean
  macd: boolean
  rsi: boolean
}

const DEFAULT_INDICATORS: IndicatorConfig = {
  ma: { enabled: true, periods: [5, 10, 20] },
  boll: false,
  macd: false,
  rsi: false,
}

const BASE_CHART_HEIGHT = 420
const VOLUME_HEIGHT = 80
const MACD_HEIGHT = 100
const RSI_HEIGHT = 80

const MA_COLORS: Record<number, string> = {
  5: '#fbbf24',
  10: '#3b82f6',
  20: '#a855f7',
  60: '#f97316',
}

const BOLL_COLORS = {
  upper: 'rgba(236, 72, 153, 0.6)',
  middle: 'rgba(236, 72, 153, 0.9)',
  lower: 'rgba(236, 72, 153, 0.6)',
}

const MACD_COLORS = {
  macd: '#3b82f6',
  signal: '#f97316',
  positive: 'rgba(0, 230, 118, 0.5)',
  negative: 'rgba(255, 23, 68, 0.5)',
}

const RSI_COLORS = {
  line: '#a855f7',
  overbought: 'rgba(255, 23, 68, 0.3)',
  oversold: 'rgba(0, 230, 118, 0.3)',
}

interface KlineChartProps {
  stock: FileStock
  indicators?: Partial<IndicatorConfig>
}

export default function KlineChart({ stock, indicators: indicatorOverrides }: KlineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const maSeriesRefs = useRef<Map<number, ISeriesApi<'Line'>>>(new Map())
  const bollSeriesRefs = useRef<{
    upper?: ISeriesApi<'Line'>
    middle?: ISeriesApi<'Line'>
    lower?: ISeriesApi<'Line'>
  }>({})
  const macdSeriesRefs = useRef<{
    macd?: ISeriesApi<'Line'>
    signal?: ISeriesApi<'Line'>
    histogram?: ISeriesApi<'Histogram'>
  }>({})
  const rsiSeriesRefs = useRef<{
    line?: ISeriesApi<'Line'>
    overbought?: ISeriesApi<'Line'>
    oversold?: ISeriesApi<'Line'>
  }>({})

  const indicators = useMemo<IndicatorConfig>(
    () => {
      const merged = { ...DEFAULT_INDICATORS, ...indicatorOverrides }
      merged.ma = { ...DEFAULT_INDICATORS.ma, ...(indicatorOverrides?.ma || {}) }
      return merged
    },
    [indicatorOverrides],
  )

  const closes = useMemo(() => stock.candles.map((c) => c.close), [stock])
  const times = useMemo(() => stock.candles.map((c) => c.time), [stock])

  const totalHeight = useMemo(() => {
    let h = BASE_CHART_HEIGHT
    if (indicators.macd) h += MACD_HEIGHT
    if (indicators.rsi) h += RSI_HEIGHT
    return h
  }, [indicators.macd, indicators.rsi])

  const maDataMap = useMemo(() => {
    const result = new Map<number, IndicatorPoint[]>()
    if (!indicators.ma.enabled) return result
    for (const period of indicators.ma.periods) {
      const raw = sma(closes, period)
      const offset = period - 1
      const data = raw.map((p, i) => ({
        time: times[i + offset] as Time,
        value: p.value,
      }))
      result.set(period, data)
    }
    return result
  }, [closes, times, indicators.ma])

  const bollData = useMemo<BOLLPoint[] | null>(() => {
    if (!indicators.boll) return null
    return boll(closes, times, 20, 2)
  }, [closes, times, indicators.boll])

  const macdData = useMemo<MACDPoint[] | null>(() => {
    if (!indicators.macd) return null
    return macd(closes, times)
  }, [closes, times, indicators.macd])

  const rsiData = useMemo<IndicatorPoint[] | null>(() => {
    if (!indicators.rsi) return null
    return rsi(closes, times, 14)
  }, [closes, times, indicators.rsi])

  function clearAllSeries() {
    const chart = chartRef.current
    if (!chart) return

    for (const series of maSeriesRefs.current.values()) {
      chart.removeSeries(series)
    }
    maSeriesRefs.current.clear()

    if (bollSeriesRefs.current.upper) chart.removeSeries(bollSeriesRefs.current.upper)
    if (bollSeriesRefs.current.middle) chart.removeSeries(bollSeriesRefs.current.middle)
    if (bollSeriesRefs.current.lower) chart.removeSeries(bollSeriesRefs.current.lower)
    bollSeriesRefs.current = {}

    if (macdSeriesRefs.current.macd) chart.removeSeries(macdSeriesRefs.current.macd)
    if (macdSeriesRefs.current.signal) chart.removeSeries(macdSeriesRefs.current.signal)
    if (macdSeriesRefs.current.histogram) chart.removeSeries(macdSeriesRefs.current.histogram)
    macdSeriesRefs.current = {}

    if (rsiSeriesRefs.current.line) chart.removeSeries(rsiSeriesRefs.current.line)
    if (rsiSeriesRefs.current.overbought) chart.removeSeries(rsiSeriesRefs.current.overbought)
    if (rsiSeriesRefs.current.oversold) chart.removeSeries(rsiSeriesRefs.current.oversold)
    rsiSeriesRefs.current = {}
  }

  useEffect(() => {
    if (!chartContainerRef.current) return
    if (chartRef.current) {
      clearAllSeries()
      chartRef.current.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
    }

    const container = chartContainerRef.current

    const extraHeight = (indicators.macd ? MACD_HEIGHT : 0) + (indicators.rsi ? RSI_HEIGHT : 0)
    const mainChartBottom = VOLUME_HEIGHT + extraHeight
    const chartH = BASE_CHART_HEIGHT + extraHeight

    const chartOptions: DeepPartial<ChartOptions> = {
      width: container.clientWidth,
      height: chartH,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
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
          top: 0.05,
          bottom: mainChartBottom / chartH + 0.02,
        },
      },
      leftPriceScale: { visible: false },
      handleScroll: {
        horzTouchDrag: true,
        vertTouchDrag: false,
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: false },
        mouseWheel: true,
        pinch: true,
      },
    }

    const chart = createChart(container, chartOptions)
    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00e676',
      downColor: '#ff1744',
      borderUpColor: '#00e676',
      borderDownColor: '#ff1744',
      wickUpColor: WICK_STYLE.upColor,
      wickDownColor: WICK_STYLE.downColor,
    })
    candleSeriesRef.current = candleSeries

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    volumeSeriesRef.current = volumeSeries

    const volumeTop = (BASE_CHART_HEIGHT - VOLUME_HEIGHT - extraHeight) / chartH + 0.02
    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: volumeTop,
        bottom: extraHeight / chartH,
      },
    })

    if (indicators.macd) {
      const macdTop = (BASE_CHART_HEIGHT - extraHeight) / chartH + 0.02
      const macdBottom = indicators.rsi ? RSI_HEIGHT / chartH : 0
      chart.priceScale('macd').applyOptions({
        scaleMargins: { top: macdTop, bottom: macdBottom },
      })
    }

    if (indicators.rsi) {
      const rsiTop = (BASE_CHART_HEIGHT - extraHeight + (indicators.macd ? MACD_HEIGHT : 0)) / chartH + 0.02
      chart.priceScale('rsi').applyOptions({
        scaleMargins: { top: rsiTop, bottom: 0 },
      })
    }

    const handleResize = () => {
      if (!chartContainerRef.current || !chartRef.current) return
      chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [totalHeight, indicators.macd, indicators.rsi])

  useEffect(() => {
    const chart = chartRef.current
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!chart || !candleSeries || !volumeSeries) return

    clearAllSeries()

    const candleData: CandlestickData[] = stock.candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))
    candleSeries.setData(candleData)

    const volumeData: HistogramData[] = stock.candles.map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0, 230, 118, 0.25)' : 'rgba(255, 23, 68, 0.25)',
    }))
    volumeSeries.setData(volumeData)

    if (indicators.ma.enabled) {
      for (const period of indicators.ma.periods) {
        const data = maDataMap.get(period)
        if (!data) continue
        const series = chart.addSeries(LineSeries, {
          color: MA_COLORS[period] || '#94a3b8',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: `MA${period}`,
        })
        maSeriesRefs.current.set(period, series)
        series.setData(data as LineData[])
      }
    }

    if (bollData && indicators.boll) {
      const upper = chart.addSeries(LineSeries, {
        color: BOLL_COLORS.upper,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      const middle = chart.addSeries(LineSeries, {
        color: BOLL_COLORS.middle,
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      const lower = chart.addSeries(LineSeries, {
        color: BOLL_COLORS.lower,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      bollSeriesRefs.current = { upper, middle, lower }
      upper.setData(bollData.map((p) => ({ time: p.time, value: p.upper })) as LineData[])
      middle.setData(bollData.map((p) => ({ time: p.time, value: p.middle })) as LineData[])
      lower.setData(bollData.map((p) => ({ time: p.time, value: p.lower })) as LineData[])
    }

    if (macdData && indicators.macd) {
      const macdLine = chart.addSeries(LineSeries, {
        color: MACD_COLORS.macd,
        lineWidth: 1,
        priceScaleId: 'macd',
        priceLineVisible: false,
        lastValueVisible: true,
        title: 'MACD',
      })
      const signalLine = chart.addSeries(LineSeries, {
        color: MACD_COLORS.signal,
        lineWidth: 1,
        priceScaleId: 'macd',
        priceLineVisible: false,
        lastValueVisible: true,
        title: 'SIGNAL',
      })
      const hist = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'price' },
        priceScaleId: 'macd',
        priceLineVisible: false,
      })
      macdSeriesRefs.current = { macd: macdLine, signal: signalLine, histogram: hist }
      macdLine.setData(macdData.map((p) => ({ time: p.time, value: p.macd })) as LineData[])
      signalLine.setData(macdData.map((p) => ({ time: p.time, value: p.signal })) as LineData[])
      hist.setData(
        macdData.map((p) => ({
          time: p.time,
          value: p.histogram,
          color: p.histogram >= 0 ? MACD_COLORS.positive : MACD_COLORS.negative,
        })) as HistogramData[],
      )
    }

    if (rsiData && indicators.rsi) {
      const line = chart.addSeries(LineSeries, {
        color: RSI_COLORS.line,
        lineWidth: 1,
        priceScaleId: 'rsi',
        priceLineVisible: false,
        lastValueVisible: true,
        title: 'RSI(14)',
      })
      const overbought = chart.addSeries(LineSeries, {
        color: RSI_COLORS.overbought,
        lineWidth: 1,
        lineStyle: 2,
        priceScaleId: 'rsi',
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      const oversold = chart.addSeries(LineSeries, {
        color: RSI_COLORS.oversold,
        lineWidth: 1,
        lineStyle: 2,
        priceScaleId: 'rsi',
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      rsiSeriesRefs.current = { line, overbought, oversold }
      line.setData(rsiData.map((p) => ({ time: p.time, value: p.value })) as LineData[])
      overbought.setData(rsiData.map((p) => ({ time: p.time, value: 70 })) as LineData[])
      oversold.setData(rsiData.map((p) => ({ time: p.time, value: 30 })) as LineData[])
    }

    chart.timeScale().scrollToRealTime()
  }, [stock, indicators, maDataMap, bollData, macdData, rsiData, totalHeight])

  return (
    <div className="w-full">
      <div ref={chartContainerRef} className="w-full" />
    </div>
  )
}

export { DEFAULT_INDICATORS }
