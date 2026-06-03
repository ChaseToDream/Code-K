import { useMemo } from 'react'
import type { FileStock } from '../lib/types'

export interface IndexCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MarketStats {
  upCount: number
  flatCount: number
  downCount: number
  totalCommits: number
  topAuthor: string
  avgVolumePerCommit: number
}

export interface SectorInfo {
  name: string
  totalLines: number
  avgChangePercent: number
  fileCount: number
}

export interface TopMover {
  path: string
  ticker: string
  changePercent: number
  currentLines: number
  volume: number
  commitMessage: string
}

export interface MarketIndexResult {
  indexCandles: IndexCandle[]
  currentIndex: number
  indexChange: number
  indexChangePercent: number
  marketStats: MarketStats
  sectors: SectorInfo[]
  topGainers: TopMover[]
  topLosers: TopMover[]
  topVolume: TopMover[]
}

/**
 * 根据文件路径提取扩展名作为板块名
 */
function getSectorName(path: string): string {
  const match = path.match(/\.([^.]+)$/)
  return match ? match[1].toUpperCase() : 'NO-EXT'
}

/**
 * 计算综合指数和市场统计数据
 */
export function useMarketIndex(stocks: FileStock[]): MarketIndexResult {
  return useMemo(() => {
    if (stocks.length === 0) {
      return {
        indexCandles: [],
        currentIndex: 1000,
        indexChange: 0,
        indexChangePercent: 0,
        marketStats: { upCount: 0, flatCount: 0, downCount: 0, totalCommits: 0, topAuthor: '-', avgVolumePerCommit: 0 },
        sectors: [],
        topGainers: [],
        topLosers: [],
        topVolume: [],
      }
    }

    // ========== 1. 综合指数计算 ==========
    // 收集所有 commit 事件，按时间分组
    const commitMap = new Map<number, { totalVolume: number; files: Map<string, number> }>()

    for (const stock of stocks) {
      for (const candle of stock.candles) {
        const entry = commitMap.get(candle.time)
        if (entry) {
          entry.totalVolume += candle.volume
          // 记录该 commit 后该文件的行数
          entry.files.set(stock.path, candle.close)
        } else {
          const files = new Map<string, number>()
          files.set(stock.path, candle.close)
          commitMap.set(candle.time, { totalVolume: candle.volume, files })
        }
      }
    }

    // 按时间排序
    const sortedTimes = Array.from(commitMap.keys()).sort((a, b) => a - b)

    // 维护每个文件的最新行数
    const fileLines = new Map<string, number>()
    let baseTotalLines = 0
    let prevTotalLines = 0
    const indexCandles: IndexCandle[] = []

    for (const time of sortedTimes) {
      const commitData = commitMap.get(time)!

      // 更新文件行数
      for (const [path, lines] of commitData.files) {
        fileLines.set(path, lines)
      }

      // 计算当前总代码行数
      const totalLines = Array.from(fileLines.values()).reduce((sum, lines) => sum + lines, 0)

      if (baseTotalLines === 0) {
        baseTotalLines = totalLines || 1 // 避免除零
      }

      const open = prevTotalLines || baseTotalLines
      const close = totalLines || baseTotalLines
      const pointOpen = 1000 * (open / baseTotalLines)
      const pointClose = 1000 * (close / baseTotalLines)

      indexCandles.push({
        time,
        open: pointOpen,
        high: Math.max(pointOpen, pointClose),
        low: Math.min(pointOpen, pointClose),
        close: pointClose,
        volume: commitData.totalVolume,
      })

      prevTotalLines = close
    }

    const currentIndex = indexCandles.length > 0 ? indexCandles[indexCandles.length - 1].close : 1000
    const prevIndex = indexCandles.length > 1 ? indexCandles[indexCandles.length - 2].close : currentIndex
    const indexChange = currentIndex - prevIndex
    const indexChangePercent = prevIndex > 0 ? (indexChange / prevIndex) * 100 : 0

    // ========== 2. 市场统计 ==========
    let upCount = 0
    let flatCount = 0
    let downCount = 0
    const authorCounts = new Map<string, number>()
    const commitHashes = new Set<string>()
    let totalVolume = 0

    for (const stock of stocks) {
      if (stock.changePercent > 0) upCount++
      else if (stock.changePercent === 0) flatCount++
      else downCount++

      for (const candle of stock.candles) {
        commitHashes.add(candle.commitHash)
        totalVolume += candle.volume
        if (candle.author) {
          authorCounts.set(candle.author, (authorCounts.get(candle.author) || 0) + 1)
        }
      }
    }

    let topAuthor = '-'
    let topAuthorCount = 0
    for (const [author, count] of authorCounts) {
      if (count > topAuthorCount) {
        topAuthorCount = count
        topAuthor = author
      }
    }

    const marketStats: MarketStats = {
      upCount,
      flatCount,
      downCount,
      totalCommits: commitHashes.size,
      topAuthor,
      avgVolumePerCommit: commitHashes.size > 0 ? Math.round(totalVolume / commitHashes.size) : 0,
    }

    // ========== 3. 板块统计 ==========
    const sectorMap = new Map<string, { totalLines: number; totalChange: number; fileCount: number }>()

    for (const stock of stocks) {
      const sector = getSectorName(stock.path)
      const existing = sectorMap.get(sector)
      if (existing) {
        existing.totalLines += stock.currentLines
        existing.totalChange += stock.changePercent
        existing.fileCount += 1
      } else {
        sectorMap.set(sector, {
          totalLines: stock.currentLines,
          totalChange: stock.changePercent,
          fileCount: 1,
        })
      }
    }

    const sectors: SectorInfo[] = Array.from(sectorMap.entries())
      .map(([name, data]) => ({
        name,
        totalLines: data.totalLines,
        avgChangePercent: data.fileCount > 0 ? data.totalChange / data.fileCount : 0,
        fileCount: data.fileCount,
      }))
      .sort((a, b) => b.totalLines - a.totalLines)

    // ========== 4. 热门排行 ==========
    const activeStocks = stocks.filter(s => s.status !== 'delisted')

    const topGainers: TopMover[] = [...activeStocks]
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, 5)
      .map(s => ({
        path: s.path,
        ticker: s.ticker,
        changePercent: s.changePercent,
        currentLines: s.currentLines,
        volume: s.candles.length > 0 ? s.candles[s.candles.length - 1].volume : 0,
        commitMessage: s.candles.length > 0 ? s.candles[s.candles.length - 1].commitMessage : '',
      }))

    const topLosers: TopMover[] = [...activeStocks]
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, 5)
      .map(s => ({
        path: s.path,
        ticker: s.ticker,
        changePercent: s.changePercent,
        currentLines: s.currentLines,
        volume: s.candles.length > 0 ? s.candles[s.candles.length - 1].volume : 0,
        commitMessage: s.candles.length > 0 ? s.candles[s.candles.length - 1].commitMessage : '',
      }))

    const topVolume: TopMover[] = [...activeStocks]
      .sort((a, b) => {
        const volA = a.candles.length > 0 ? a.candles[a.candles.length - 1].volume : 0
        const volB = b.candles.length > 0 ? b.candles[b.candles.length - 1].volume : 0
        return volB - volA
      })
      .slice(0, 5)
      .map(s => ({
        path: s.path,
        ticker: s.ticker,
        changePercent: s.changePercent,
        currentLines: s.currentLines,
        volume: s.candles.length > 0 ? s.candles[s.candles.length - 1].volume : 0,
        commitMessage: s.candles.length > 0 ? s.candles[s.candles.length - 1].commitMessage : '',
      }))

    return {
      indexCandles,
      currentIndex,
      indexChange,
      indexChangePercent,
      marketStats,
      sectors,
      topGainers,
      topLosers,
      topVolume,
    }
  }, [stocks])
}
