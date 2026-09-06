import { useMemo } from 'react'
import type { CandleData } from '../lib/types'
import { CHART_COLORS } from '../lib/chart-config'

interface SparklineChartProps {
  candles: CandleData[]
  width?: number
  height?: number
}

const PAD = 1

/**
 * 迷你走势图 —— 纯 SVG polyline 实现。
 * 虚拟列表每行一个实例，轻量级 DOM，滚动时无 createChart/remove 开销。
 */
export default function SparklineChart({ candles, width = 120, height = 32 }: SparklineChartProps) {
  const { linePoints, areaPoints, color, areaColor } = useMemo(() => {
    const closes = candles.map((c) => c.close)
    let min = Math.min(...closes)
    let max = Math.max(...closes)
    if (min === max) {
      min -= 1
      max += 1
    }

    const innerW = width - PAD * 2
    const innerH = height - PAD * 2
    const stepX = closes.length > 1 ? innerW / (closes.length - 1) : 0

    const points = closes.map((close, i) => {
      const x = closes.length > 1 ? PAD + i * stepX : width / 2
      const y = PAD + (1 - (close - min) / (max - min)) * innerH
      return [x, y] as const
    })

    const isUp = closes[closes.length - 1] >= candles[0].open

    return {
      linePoints: points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '),
      areaPoints: `${PAD},${height - PAD} ${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')} ${width - PAD},${height - PAD}`,
      color: isUp ? CHART_COLORS.up : CHART_COLORS.down,
      areaColor: isUp ? CHART_COLORS.upArea : CHART_COLORS.downArea,
    }
  }, [candles, width, height])

  if (candles.length === 0) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center">
        <span className="text-ex-dim text-xs font-mono">--</span>
      </div>
    )
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      aria-hidden="true"
    >
      {candles.length > 1 && (
        <polygon points={areaPoints} fill={areaColor} stroke="none" />
      )}
      {candles.length > 1 ? (
        <polyline
          points={linePoints}
          fill="none"
          stroke={color}
          strokeWidth="1"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : (
        <circle cx={width / 2} cy={height / 2} r="1.5" fill={color} />
      )}
    </svg>
  )
}
