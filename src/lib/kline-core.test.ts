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
  it('创建一根标准 K 线蜡烛（volume = additions + deletions）', () => {
    // open=100, additions=60, deletions=10 → close=150
    const candle = createCandle(mockCommit, { additions: 60, deletions: 10 }, 100, 150)
    expect(candle).toEqual({
      time: 1700000000,
      open: 100,
      high: 160, // open + additions
      low: 90,   // open - deletions
      close: 150,
      volume: 70,
      additions: 60,
      deletions: 10,
      commitMessage: 'feat: add new component',
      commitHash: 'abc123de',
      author: 'test-user',
    })
  })

  it('创建下跌蜡烛', () => {
    // open=200, additions=50, deletions=200 → close=50
    const candle = createCandle(mockCommit, { additions: 50, deletions: 200 }, 200, 50)
    expect(candle.open).toBe(200)
    expect(candle.close).toBe(50)
    expect(candle.high).toBe(250) // 200 + 50
    expect(candle.low).toBe(0)    // max(0, 200 - 200)
    expect(candle.volume).toBe(250)
    expect(candle.additions).toBe(50)
    expect(candle.deletions).toBe(200)
  })

  it('创建 IPO 蜡烛（open=0）', () => {
    const candle = createCandle(mockCommit, { additions: 100, deletions: 0 }, 0, 100)
    expect(candle.open).toBe(0)
    expect(candle.close).toBe(100)
    expect(candle.high).toBe(100)
    expect(candle.low).toBe(0)
  })

  describe('带 additions/deletions 的影线（波动幅度语义）', () => {
    it('纯增：high = open + additions，low = open', () => {
      // open=100, close=150（净增 50）；additions=60, deletions=10
      const candle = createCandle(mockCommit, { additions: 60, deletions: 10 }, 100, 150)
      expect(candle.high).toBe(160) // 100 + 60
      expect(candle.low).toBe(90)   // max(0, 100 - 10) = 90
      expect(candle.close).toBe(150)
    })

    it('纯删：low = open - deletions，high = open', () => {
      // open=200, close=150（净删 50）；additions=0, deletions=50
      const candle = createCandle(mockCommit, { additions: 0, deletions: 50 }, 200, 150)
      expect(candle.high).toBe(200) // max(200 + 0, 150) = 200
      expect(candle.low).toBe(150)  // min(max(0, 200-50), 150) = min(150, 150) = 150
    })

    it('先删后加（low 下探到 0 边界）', () => {
      // open=10, deletions=20 → 理论谷底 max(0, 10-20)=0；close=30
      const candle = createCandle(mockCommit, { additions: 40, deletions: 20 }, 10, 30)
      expect(candle.low).toBe(0)    // 被下界 0 截断
      expect(candle.high).toBe(50)  // 10 + 40
    })

    it('混合增删：同时有上影线和下影线（对标真实股票）', () => {
      // open=100, additions=80, deletions=60 → close=120
      // peak = 100+80 = 180（上影线顶端）
      // trough = max(0, 100-60) = 40（下影线底端）
      const candle = createCandle(mockCommit, { additions: 80, deletions: 60 }, 100, 120)
      expect(candle.high).toBe(180) // 上影线 = 180 - 120 = 60
      expect(candle.low).toBe(40)   // 下影线 = 100 - 40 = 60
      expect(candle.close).toBe(120)
    })

    it('纯增只有上影线无下影线（对标真实股票纯阳线）', () => {
      // open=50, additions=100, deletions=0 → close=150
      // peak = 150, trough = max(0, 50) = 50 = open → 无下影线
      const candle = createCandle(mockCommit, { additions: 100, deletions: 0 }, 50, 150)
      expect(candle.high).toBe(150) // = open + additions = close（无上影线，因为 close 达到峰值）
      expect(candle.low).toBe(50)   // = open（无下影线，因为文件单调增长）
    })

    it('additions=0 且 deletions=0：影线退化为实体端点', () => {
      const candle = createCandle(mockCommit, { additions: 0, deletions: 0 }, 100, 100)
      expect(candle.high).toBe(100)
      expect(candle.low).toBe(100)
      expect(candle.volume).toBe(0)
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
        const candle = createCandle(mockCommit, { additions: c.additions, deletions: c.deletions }, c.open, c.close)
        const bodyHigh = Math.max(c.open, c.close)
        const bodyLow = Math.min(c.open, c.close)
        expect(candle.high).toBeGreaterThanOrEqual(bodyHigh)
        expect(bodyLow).toBeGreaterThanOrEqual(candle.low)
        expect(candle.low).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('additions/deletions 与内容透传', () => {
    it('candle 上携带 additions/deletions，volume 为两者之和', () => {
      const candle = createCandle(mockCommit, { additions: 12, deletions: 5 }, 100, 107)
      expect(candle.additions).toBe(12)
      expect(candle.deletions).toBe(5)
      expect(candle.volume).toBe(17)
    })

    it('fileChange 携带 oldContent/newContent 时透传到 candle', () => {
      const candle = createCandle(
        mockCommit,
        { additions: 1, deletions: 1, oldContent: 'before', newContent: 'after' },
        10,
        10,
      )
      expect(candle.oldContent).toBe('before')
      expect(candle.newContent).toBe('after')
    })

    it('fileChange 不携带内容时 candle 上没有内容字段', () => {
      const candle = createCandle(mockCommit, { additions: 1, deletions: 0 }, 10, 11)
      expect(candle.oldContent).toBeUndefined()
      expect(candle.newContent).toBeUndefined()
      expect('oldContent' in candle).toBe(false)
      expect('newContent' in candle).toBe(false)
    })

    it('fileChange 为空内容字符串时也照常透传', () => {
      const candle = createCandle(
        mockCommit,
        { additions: 0, deletions: 3, oldContent: 'a\nb\nc', newContent: '' },
        3,
        0,
      )
      expect(candle.oldContent).toBe('a\nb\nc')
      expect(candle.newContent).toBe('')
    })

    it('fileChange 缺省时 additions/deletions 兜底为 0（与后端行为一致）', () => {
      const candle = createCandle(mockCommit, undefined, 100, 150)
      expect(candle.additions).toBe(0)
      expect(candle.deletions).toBe(0)
      expect(candle.volume).toBe(0)
      expect(candle.high).toBe(150) // max(open, close)
      expect(candle.low).toBe(100)  // min(open, close)
    })
  })
})

describe('calcChangePercent', () => {
  it('上涨时计算正确百分比', () => {
    const candle: CandleData = createCandle(mockCommit, { additions: 50, deletions: 0 }, 100, 150)
    expect(calcChangePercent(candle)).toBe(50)
  })

  it('下跌时计算正确百分比', () => {
    const candle: CandleData = createCandle(mockCommit, { additions: 0, deletions: 20 }, 100, 80)
    expect(calcChangePercent(candle)).toBe(-20)
  })

  it('IPO 蜡烛（open=0, close>0）返回 100', () => {
    const candle: CandleData = createCandle(mockCommit, { additions: 100, deletions: 0 }, 0, 100)
    expect(calcChangePercent(candle)).toBe(100)
  })

  it('退市蜡烛（open>0, close=0）返回 -100', () => {
    const candle: CandleData = createCandle(mockCommit, { additions: 0, deletions: 100 }, 100, 0)
    expect(calcChangePercent(candle)).toBe(-100)
  })

  it('open=0 且 close=0 返回 0', () => {
    const candle: CandleData = createCandle(mockCommit, { additions: 0, deletions: 0 }, 0, 0)
    expect(calcChangePercent(candle)).toBe(0)
  })
})
