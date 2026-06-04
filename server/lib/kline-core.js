/**
 * K线核心逻辑 — 前后端共享的纯函数
 * ⚠️ 警告：此为 src/lib/kline-core.ts 的同步副本。请勿直接修改此文件。
 *    修改请编辑 src/lib/kline-core.ts，然后手动同步到此处。
 */

/**
 * 生成仓库 ID
 * 前后端统一使用 base64 编码前 12 字符
 * @param {string} repoPath
 * @returns {string}
 */
export function generateRepoId(repoPath) {
  return Buffer.from(repoPath).toString('base64').slice(0, 12)
}

/**
 * 根据文件路径生成股票代码
 * 例: "src/components/Layout.tsx" → "LAYOUT.TSX"
 */
export function generateTicker(path) {
  const parts = path.split('/')
  const filename = parts[parts.length - 1]
  const name = filename.replace(/\.[^.]+$/, '').toUpperCase()
  const ext = filename.includes('.') ? filename.split('.').pop().toUpperCase() : ''
  const shortName = name.slice(0, 6)
  return ext ? `${shortName}.${ext.slice(0, 3)}` : shortName
}

/**
 * 创建一根 K 线蜡烛
 */
export function createCandle(open, close, volume, commit) {
  return {
    time: commit.timestamp,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume,
    commitMessage: commit.message,
    commitHash: commit.oid.slice(0, 8),
    author: commit.author,
  }
}

/**
 * 根据最后一根蜡烛计算涨跌幅
 */
export function calcChangePercent(lastCandle) {
  return lastCandle.open > 0
    ? ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100
    : lastCandle.close > 0 ? 100 : 0
}