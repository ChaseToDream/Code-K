/**
 * K线核心逻辑 — 前后端共享的纯函数
 * 与 server/lib/kline-core.js 保持同步
 */
import type { CandleData, CommitInfo } from './types';

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
 * 创建一根 K 线蜡烛
 */
export function createCandle(
  open: number,
  close: number,
  volume: number,
  commit: CommitInfo,
): CandleData {
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