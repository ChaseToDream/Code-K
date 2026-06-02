import type { FileStock } from './types'

export function exportToCSV(stocks: FileStock[], filename: string = 'stocks.csv'): void {
  const headers = ['文件路径', '股票代码', '状态', '当前行数', '涨跌幅(%)', '总新增', '总删除', '提交次数']
  
  const rows = stocks.map(stock => [
    stock.path,
    stock.ticker,
    stock.status,
    stock.currentLines.toString(),
    stock.changePercent.toFixed(2),
    stock.totalAdditions.toString(),
    stock.totalDeletions.toString(),
    stock.candles.length.toString(),
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n')

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function exportChartToPNG(chartContainer: HTMLElement, filename: string = 'chart.png'): void {
  const canvas = chartContainer.querySelector('canvas')
  if (!canvas) {
    console.error('No canvas found in chart container')
    return
  }

  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export function exportStockDetails(stock: FileStock): void {
  const data = {
    path: stock.path,
    ticker: stock.ticker,
    status: stock.status,
    currentLines: stock.currentLines,
    changePercent: stock.changePercent,
    totalAdditions: stock.totalAdditions,
    totalDeletions: stock.totalDeletions,
    firstCommit: stock.firstCommit,
    lastCommit: stock.lastCommit,
    candles: stock.candles.map(c => ({
      time: new Date(c.time * 1000).toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      commitMessage: c.commitMessage,
      commitHash: c.commitHash,
      author: c.author,
    })),
  }

  const jsonContent = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonContent], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${stock.ticker}_details.json`
  link.click()
  URL.revokeObjectURL(url)
}
