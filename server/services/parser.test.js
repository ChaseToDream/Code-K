/**
 * parser 服务核心函数测试
 */
import { describe, it, expect } from 'vitest'
import { buildFileStocks, generateRepoId } from './parser.js'

// mock commit 序列: 时间正序（模拟 git log --reverse 输出）
const mockCommits = [
  {
    commit: { oid: 'aaa111222333', author: 'alice', timestamp: 1000, message: 'init' },
    files: [
      { path: 'src/App.tsx', additions: 50, deletions: 0 },
      { path: 'src/index.ts', additions: 10, deletions: 0 },
    ],
  },
  {
    commit: { oid: 'bbb111222333', author: 'bob', timestamp: 2000, message: 'feat: add header' },
    files: [
      { path: 'src/App.tsx', additions: 20, deletions: 5 },
      { path: 'src/Header.tsx', additions: 30, deletions: 0 },
    ],
  },
  {
    commit: { oid: 'ccc111222333', author: 'alice', timestamp: 3000, message: 'refactor: cleanup' },
    files: [
      { path: 'src/App.tsx', additions: 0, deletions: 10 },
      { path: 'src/Header.tsx', additions: 5, deletions: 2 },
    ],
  },
]

describe('buildFileStocks', () => {
  it('构建正确的股票数量', () => {
    const stocks = buildFileStocks(mockCommits, 'test123')
    expect(stocks.length).toBe(3)
  })

  it('按行数降序排列', () => {
    const stocks = buildFileStocks(mockCommits, 'test123')
    expect(stocks[0].currentLines).toBeGreaterThanOrEqual(stocks[1].currentLines)
    expect(stocks[1].currentLines).toBeGreaterThanOrEqual(stocks[2].currentLines)
  })

  it('App.tsx 行数计算正确: 50+15-10=55', () => {
    const stocks = buildFileStocks(mockCommits, 'test123')
    const app = stocks.find(s => s.path === 'src/App.tsx')
    expect(app).toBeDefined()
    expect(app.currentLines).toBe(55)
    expect(app.candles.length).toBe(3)
  })

  it('新文件 index.ts 为 IPO 状态（仅一次提交）', () => {
    const stocks = buildFileStocks(mockCommits, 'test123')
    const idx = stocks.find(s => s.path === 'src/index.ts')
    expect(idx).toBeDefined()
    expect(idx.status).toBe('ipo')
    expect(idx.candles.length).toBe(1)
  })

  it('已有多次提交的 Header.tsx 为 active 状态', () => {
    const stocks = buildFileStocks(mockCommits, 'test123')
    const header = stocks.find(s => s.path === 'src/Header.tsx')
    expect(header).toBeDefined()
    expect(header.status).toBe('active')
    expect(header.candles.length).toBe(2)
  })

  it('每个文件有正确的蜡烛数量', () => {
    const stocks = buildFileStocks(mockCommits, 'test123')
    const app = stocks.find(s => s.path === 'src/App.tsx')
    const idx = stocks.find(s => s.path === 'src/index.ts')
    const header = stocks.find(s => s.path === 'src/Header.tsx')

    expect(app.candles.length).toBe(3)
    expect(idx.candles.length).toBe(1)
    expect(header.candles.length).toBe(2)
  })

  it('退市状态正确识别', () => {
    const delistedCommits = [
      {
        commit: { oid: 'aaa', author: 'alice', timestamp: 1000, message: 'init' },
        files: [{ path: 'tmp.ts', additions: 100, deletions: 0 }],
      },
      {
        commit: { oid: 'bbb', author: 'bob', timestamp: 2000, message: 'remove' },
        files: [{ path: 'tmp.ts', additions: 0, deletions: 100 }],
      },
    ]
    const stocks = buildFileStocks(delistedCommits, 'test')
    const tmp = stocks.find(s => s.path === 'tmp.ts')
    expect(tmp.status).toBe('delisted')
    expect(tmp.currentLines).toBe(0)
  })

  it('空 commits 返回空数组', () => {
    const stocks = buildFileStocks([], 'test')
    expect(stocks.length).toBe(0)
  })
})

describe('generateRepoId', () => {
  it('生成固定长度 ID', () => {
    const id = generateRepoId('/home/user/my-project')
    expect(id.length).toBeLessThanOrEqual(12)
  })

  it('相同路径生成相同 ID', () => {
    const id1 = generateRepoId('/same/path')
    const id2 = generateRepoId('/same/path')
    expect(id1).toBe(id2)
  })

  it('不同路径生成不同 ID', () => {
    const id1 = generateRepoId('/path/one')
    const id2 = generateRepoId('/path/two')
    expect(id1).not.toBe(id2)
  })
})