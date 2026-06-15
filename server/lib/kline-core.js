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
 *
 * 影线（high/low）语义：
 * - 默认（不传 options，向后兼容）：high = max(open, close)、low = min(open, close)，影线长度为 0
 * - 传入 additions/deletions（推荐）：影线反映本次 commit 期间文件行数的波动幅度
 *   - high = max(open + additions, close)  —— 文件膨胀到的峰值
 *   - low  = min(max(0, open - deletions), close) —— 文件收缩到的谷底（不低于 0）
 *
 * 不变量：high >= max(open, close) >= min(open, close) >= low >= 0
 *
 * @param {number} open
 * @param {number} close
 * @param {number} volume
 * @param {object} commit
 * @param {{additions?: number, deletions?: number}} [options]
 */
export function createCandle(open, close, volume, commit, options) {
  const hasWickData =
    options !== undefined &&
    (typeof options.additions === 'number' || typeof options.deletions === 'number')

  const high = hasWickData
    ? Math.max(open + (options.additions ?? 0), close)
    : Math.max(open, close)
  const low = hasWickData
    ? Math.min(Math.max(0, open - (options.deletions ?? 0)), close)
    : Math.min(open, close)

  return {
    time: commit.timestamp,
    open,
    high,
    low,
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