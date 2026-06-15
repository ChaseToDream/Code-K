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

  describe('带 additions/deletions 的影线（波动幅度语义）', () => {
    it('纯增：high = open + additions，low = open', () => {
      // open=100, close=150（净增 50）；additions=60, deletions=10
      const candle = createCandle(100, 150, 70, mockCommit, { additions: 60, deletions: 10 })
      expect(candle.high).toBe(160) // 100 + 60
      expect(candle.low).toBe(90)   // max(0, 100 - 10) = 90
      expect(candle.close).toBe(150)
    })

    it('纯删：low = open - deletions，high = open', () => {
      // open=200, close=150（净删 50）；additions=0, deletions=50
      const candle = createCandle(200, 150, 50, mockCommit, { additions: 0, deletions: 50 })
      expect(candle.high).toBe(200) // max(200 + 0, 150) = 200
      expect(candle.low).toBe(150)  // min(max(0, 200-50), 150) = min(150, 150) = 150
    })

    it('先删后加（low 下探到 0 边界）', () => {
      // open=10, deletions=20 → 理论谷底 max(0, 10-20)=0；close=30
      const candle = createCandle(10, 30, 50, mockCommit, { additions: 40, deletions: 20 })
      expect(candle.low).toBe(0)    // 被下界 0 截断
      expect(candle.high).toBe(50)  // 10 + 40
    })

    it('additions=0 且 deletions=0：影线退化为实体端点（与旧逻辑一致）', () => {
      const candle = createCandle(100, 100, 0, mockCommit, { additions: 0, deletions: 0 })
      expect(candle.high).toBe(100)
      expect(candle.low).toBe(100)
    })

    it('不变量：high >= max(open, close) >= min(open, close) >= low >= 0', () => {
      const cases = [
        { open: 100, close: 150, additions: 60, deletions: 10 },
        { open: 200, close: 50, additions: 5, deletions: 155 },
        { open: 10, close: 30, additions: 40, deletions: 20 },
        { open: 0, close: 100, additions: 100, deletions: 0 },
        { open: 50, close: 0, additions: 0, deletions: 50 },
      ]
      for (const c of cases) {
        const candle = createCandle(c.open, c.close, c.additions + c.deletions, mockCommit, {
          additions: c.additions,
          deletions: c.deletions,
        })
        const bodyHigh = Math.max(c.open, c.close)
        const bodyLow = Math.min(c.open, c.close)
        expect(candle.high).toBeGreaterThanOrEqual(bodyHigh)
        expect(bodyLow).toBeGreaterThanOrEqual(candle.low)
        expect(candle.low).toBeGreaterThanOrEqual(0)
      }
    })
  })

  it('不传 options 时保持向后兼容（影线长度为 0）', () => {
    const candle = createCandle(100, 150, 50, mockCommit)
    expect(candle.high).toBe(150) // max(open, close)
    expect(candle.low).toBe(100)  // min(open, close)
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