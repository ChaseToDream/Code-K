/**
 * K线核心逻辑 — 前后端共享的纯函数
 * ⚠️ 警告：此为 src/lib/kline-core.ts 的同步副本。请勿直接修改此文件。
 *    修改请编辑 src/lib/kline-core.ts，然后手动同步到此处。
 */

/**
 * 生成仓库 ID
 * 前后端统一使用完整 base64 编码（截断会导致同前缀路径碰撞，如 /home/user/ 下的所有仓库）
 * @param {string} repoPath
 * @returns {string}
 */
export function generateRepoId(repoPath) {
  return Buffer.from(repoPath).toString('base64')
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
 * 影线（high/low）语义 —— 对标真实股票蜡烛：
 * - 真实股票：high = 期间最高价，low = 期间最低价，始终满足 high ≥ 实体 ≥ low
 * - 代码仓库：一次 commit 期间文件行数会波动，极值为：
 *   - high = open + additions（先加后删时的峰值，文件膨胀到的最大行数）
 *   - low  = max(0, open − deletions)（先删后加时的谷底，文件收缩到的最小行数，不低于 0）
 *
 * 不变量（恒成立）：high ≥ max(open, close) ≥ min(open, close) ≥ low ≥ 0
 *
 * @param {object} commit - { oid, message, author, timestamp }
 * @param {object} fileChange - { additions, deletions, oldContent?, newContent? }
 * @param {number} open
 * @param {number} close
 */
export function createCandle(commit, fileChange, open, close) {
  const additions = fileChange?.additions ?? 0
  const deletions = fileChange?.deletions ?? 0

  // 影线峰值/谷底
  const peak = open + additions
  const trough = Math.max(0, open - deletions)

  // high 至少为实体上端，low 至多为实体下端（防御性兜底，保证不变量恒成立）
  const high = Math.max(peak, open, close)
  const low = Math.min(trough, open, close)

  const candle = {
    time: commit.timestamp,
    open,
    high,
    low,
    close,
    volume: additions + deletions,
    commitMessage: commit.message,
    commitHash: commit.oid.slice(0, 8),
    author: commit.author,
    additions,
    deletions,
  }

  // 内容透传：仅当 fileChange 携带时附加（后端模式通常没有内容）
  if (fileChange?.oldContent !== undefined) candle.oldContent = fileChange.oldContent
  if (fileChange?.newContent !== undefined) candle.newContent = fileChange.newContent

  return candle
}

/**
 * 根据最后一根蜡烛计算涨跌幅
 */
export function calcChangePercent(lastCandle) {
  return lastCandle.open > 0
    ? ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100
    : lastCandle.close > 0 ? 100 : 0
}