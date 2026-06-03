/**
 * kline-core 核心纯函数测试
 */
import { describe, it, expect } from 'vitest'
import { generateTicker, createCandle, calcChangePercent } from './kline-core'
import type { CommitInfo, CandleData } from './types'

// mock commit 数据
const mockCommit: CommitInfo = {
  oid: 'abc123def456789012345678901234567890abcd',
  message: 'feat: add new component',
  author: 'test-user',
  timestamp: 1700000000,
}

describe('generateTicker', () => {
  it('从普通路径生成股票代码', () => {
    expect(generateTicker('src/components/Layout.tsx')).toBe('LAYOUT.TSX')
  })

  it('从深层嵌套路径生成股票代码', () => {
    expect(generateTicker('packages/core/src/utils/helpers.ts')).toBe('HELPER.TS')
  })

  it('无扩展名文件也能处理', () => {
    expect(generateTicker('Makefile')).toBe('MAKEFI')
  })

  it('长文件名截断为6字符', () => {
    expect(generateTicker('veryLongComponentName.tsx')).toBe('VERYLO.TSX')
  })

  it('扩展名截断为3字符', () => {
    expect(generateTicker('App.component.tsx')).toBe('APP.CO.TSX')
  })
})

describe('createCandle', () => {
  it('创建一根标准 K 线蜡烛', () => {
    const candle = createCandle(100, 150, 50, mockCommit)
    expect(candle).toEqual({
      time: 1700000000,
      open: 100,
      high: 150,
      low: 100,
      close: 150,
      volume: 50,
      commitMessage: 'feat: add new component',
      commitHash: 'abc123de',
      author: 'test-user',
    })
  })

  it('创建下跌蜡烛', () => {
    const candle = createCandle(200, 50, 150, mockCommit)
    expect(candle.open).toBe(200)
    expect(candle.close).toBe(50)
    expect(candle.high).toBe(200)
    expect(candle.low).toBe(50)
    expect(candle.volume).toBe(150)
  })

  it('创建 IPO 蜡烛（open=0）', () => {
    const candle = createCandle(0, 100, 100, mockCommit)
    expect(candle.open).toBe(0)
    expect(candle.close).toBe(100)
    expect(candle.high).toBe(100)
    expect(candle.low).toBe(0)
  })
})

describe('calcChangePercent', () => {
  it('上涨时计算正确百分比', () => {
    const candle: CandleData = {
      ...createCandle(100, 150, 50, mockCommit),
    }
    expect(calcChangePercent(candle)).toBe(50)
  })

  it('下跌时计算正确百分比', () => {
    const candle: CandleData = {
      ...createCandle(100, 80, 20, mockCommit),
    }
    expect(calcChangePercent(candle)).toBe(-20)
  })

  it('IPO 蜡烛（open=0, close>0）返回 100', () => {
    const candle: CandleData = {
      ...createCandle(0, 100, 100, mockCommit),
    }
    expect(calcChangePercent(candle)).toBe(100)
  })

  it('退市蜡烛（open>0, close=0）返回 -100', () => {
    const candle: CandleData = {
      ...createCandle(100, 0, 100, mockCommit),
    }
    expect(calcChangePercent(candle)).toBe(-100)
  })

  it('open=0 且 close=0 返回 0', () => {
    const candle: CandleData = {
      ...createCandle(0, 0, 0, mockCommit),
    }
    expect(calcChangePercent(candle)).toBe(0)
  })
})