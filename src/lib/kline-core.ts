/**
 * K线核心逻辑 — 前后端共享的纯函数
 * ⚠️ 警告：此为唯一事实来源。修改后请同步更新 server/lib/kline-core.js
 */
import type { CandleData, CommitInfo } from './types';

/**
 * 生成仓库 ID
 * 前后端统一使用 base64 编码前 12 字符
 * @param repoPath 仓库绝对路径
 */
export function generateRepoId(repoPath: string): string {
  // 使用 TextEncoder + btoa 模拟 Buffer.from 行为，确保前后端一致
  const encoder = new TextEncoder();
  const data = encoder.encode(repoPath);
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).slice(0, 12);
}

/**
 * 根据文件路径生成股票代码
 * 例: "src/components/Layout.tsx" → "LAYOUT.TSX"
 */
export function generateTicker(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  const name = filename.replace(/\.[^.]+$/, '').toUpperCase();
  const ext = filename.includes('.') ? filename.split('.').pop()!.toUpperCase() : '';
  const shortName = name.slice(0, 6);
  return ext ? `${shortName}.${ext.slice(0, 3)}` : shortName;
}

/**
 * 影线计算的可配置选项
 */
export interface CandleWickOptions {
  /** 本次 commit 内新增的行数（用于推算 high 峰值） */
  additions?: number;
  /** 本次 commit 内删除的行数（用于推算 low 谷值） */
  deletions?: number;
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
 * 与实体的关系（不变量，恒成立）：
 *   high = open + additions ≥ open          （additions ≥ 0）
 *   high = open + additions ≥ close         （close = open + additions − deletions）
 *   low  = open − deletions ≤ open          （deletions ≥ 0）
 *   low  ≤ close                            （close = low + additions ≥ low）
 * 即：high ≥ max(open, close) ≥ min(open, close) ≥ low ≥ 0
 *
 * 向后兼容：不传 options 时影线长度为 0（high = max(open,close)，low = min(open,close)）。
 */
export function createCandle(
  open: number,
  close: number,
  volume: number,
  commit: CommitInfo,
  options?: CandleWickOptions,
): CandleData {
  const hasWickData =
    options !== undefined &&
    (typeof options.additions === 'number' || typeof options.deletions === 'number');

  // 影线峰值/谷底
  const peak = open + (options?.additions ?? 0);
  const trough = Math.max(0, open - (options?.deletions ?? 0));

  // high 至少为实体上端，low 至多为实体下端（防御性兜底，保证不变量恒成立）
  const high = hasWickData ? Math.max(peak, open, close) : Math.max(open, close);
  const low = hasWickData ? Math.min(trough, open, close) : Math.min(open, close);

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
  };
}

/**
 * 根据最后一根蜡烛计算涨跌幅
 */
export function calcChangePercent(lastCandle: CandleData): number {
  return lastCandle.open > 0
    ? ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100
    : lastCandle.close > 0 ? 100 : 0;
}