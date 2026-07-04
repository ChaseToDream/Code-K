/**
 * 技术指标计算模块 — 纯函数，前后端通用
 *
 * 所有指标基于收盘价 (close) 计算，返回 lightweight-charts 兼容的数据格式：
 * { time: number, value: number } 或 { time: number, ... }
 */

import type { Time } from 'lightweight-charts'

export interface IndicatorPoint {
  time: Time
  value: number
}

export interface MACDPoint {
  time: Time
  macd: number
  signal: number
  histogram: number
}

export interface BOLLPoint {
  time: Time
  upper: number
  middle: number
  lower: number
}

/**
 * 简单移动平均线 (Simple Moving Average)
 * @param closes 收盘价数组
 * @param period 周期
 */
export function sma(closes: number[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  if (closes.length < period) return result

  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) {
      sum += closes[i - j]
    }
    result.push({
      time: 0 as Time,
      value: sum / period,
    })
  }
  return result
}

/**
 * 指数移动平均线 (Exponential Moving Average)
 * @param closes 收盘价数组
 * @param period 周期
 */
export function ema(closes: number[], period: number): number[] {
  const result: number[] = []
  if (closes.length < period) return result

  const k = 2 / (period + 1)

  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += closes[i]
  }
  let prevEma = sum / period
  result.push(prevEma)

  for (let i = period; i < closes.length; i++) {
    prevEma = closes[i] * k + prevEma * (1 - k)
    result.push(prevEma)
  }
  return result
}

/**
 * 计算 EMA 并返回带时间戳的数据点
 */
export function emaPoints(closes: number[], times: number[], period: number): IndicatorPoint[] {
  const emaValues = ema(closes, period)
  if (emaValues.length === 0) return []
  return emaValues.map((value, i) => ({
    time: times[i + period - 1] as Time,
    value,
  }))
}

/**
 * MACD 指标 (Moving Average Convergence Divergence)
 * 默认参数：快EMA=12, 慢EMA=26, 信号线EMA=9
 */
export function macd(
  closes: number[],
  times: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MACDPoint[] {
  if (closes.length < slowPeriod + signalPeriod) return []

  const fastEma = ema(closes, fastPeriod)
  const slowEma = ema(closes, slowPeriod)

  const macdLine: number[] = []
  const offset = slowPeriod - fastPeriod
  for (let i = 0; i < fastEma.length - offset; i++) {
    macdLine.push(fastEma[i + offset] - slowEma[i])
  }

  const signalLine = ema(macdLine, signalPeriod)
  const signalOffset = signalPeriod - 1

  const result: MACDPoint[] = []
  const startIdx = slowPeriod + signalPeriod - 1
  for (let i = 0; i < signalLine.length; i++) {
    const macdVal = macdLine[i + signalOffset]
    const signalVal = signalLine[i]
    result.push({
      time: times[startIdx + i] as Time,
      macd: macdVal,
      signal: signalVal,
      histogram: macdVal - signalVal,
    })
  }
  return result
}

/**
 * RSI 指标 (Relative Strength Index)
 * 默认周期 14
 */
export function rsi(closes: number[], times: number[], period = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  if (closes.length < period + 1) return result

  let gains = 0
  let losses = 0

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }

  let avgGain = gains / period
  let avgLoss = losses / period

  const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss
  result.push({
    time: times[period] as Time,
    value: avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs),
  })

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    result.push({
      time: times[i] as Time,
      value: avgLoss === 0 ? 100 : 100 - 100 / (1 + rs),
    })
  }

  return result
}

/**
 * 布林带 (Bollinger Bands)
 * 默认参数：周期 20，标准差倍数 2
 */
export function boll(
  closes: number[],
  times: number[],
  period = 20,
  multiplier = 2,
): BOLLPoint[] {
  const result: BOLLPoint[] = []
  if (closes.length < period) return result

  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) {
      sum += closes[i - j]
    }
    const middle = sum / period

    let variance = 0
    for (let j = 0; j < period; j++) {
      variance += (closes[i - j] - middle) ** 2
    }
    const stdDev = Math.sqrt(variance / period)

    result.push({
      time: times[i] as Time,
      upper: middle + multiplier * stdDev,
      middle,
      lower: middle - multiplier * stdDev,
    })
  }
  return result
}

/**
 * 将指标点数组填充 time 字段（从 candles 中取对应位置的时间戳）
 */
export function fillTime<T extends { time?: Time }>(
  points: T[],
  times: number[],
  offset: number,
): T[] {
  return points.map((p, i) => ({
    ...p,
    time: times[i + offset] as Time,
  }))
}

/**
 * 金叉/死叉信号检测
 * 返回信号点：1=金叉（短均线上穿长均线），-1=死叉（短均线下穿长均线），0=无信号
 */
export function detectCrossovers(
  shortMa: IndicatorPoint[],
  longMa: IndicatorPoint[],
): Array<{ time: Time; type: 'golden' | 'death' }> {
  const signals: Array<{ time: Time; type: 'golden' | 'death' }> = []

  const shortMap = new Map(shortMa.map((p) => [Number(p.time), p.value]))
  const longMap = new Map(longMa.map((p) => [Number(p.time), p.value]))

  const commonTimes = Array.from(shortMap.keys()).filter((t) => longMap.has(t))
  commonTimes.sort((a, b) => a - b)

  let prevDiff: number | null = null
  for (const t of commonTimes) {
    const diff = shortMap.get(t)! - longMap.get(t)!
    if (prevDiff !== null) {
      if (prevDiff <= 0 && diff > 0) {
        signals.push({ time: t as Time, type: 'golden' })
      } else if (prevDiff >= 0 && diff < 0) {
        signals.push({ time: t as Time, type: 'death' })
      }
    }
    prevDiff = diff
  }

  return signals
}
