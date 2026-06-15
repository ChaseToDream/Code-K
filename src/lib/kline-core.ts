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
 * 影线（high/low）语义：
 * - 默认（不传 options，向后兼容）：high = max(open, close)、low = min(open, close)，影线长度为 0
 * - 传入 additions/deletions（推荐）：影线反映本次 commit 期间文件行数的波动幅度
 *   - high = max(open + additions, close)  —— 文件膨胀到的峰值
 *   - low  = min(max(0, open - deletions), close) —— 文件收缩到的谷底（不低于 0）
 *
 * 不变量：high >= max(open, close) >= min(open, close) >= low >= 0
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

  const high = hasWickData
    ? Math.max(open + (options!.additions ?? 0), close)
    : Math.max(open, close);
  const low = hasWickData
    ? Math.min(Math.max(0, open - (options!.deletions ?? 0)), close)
    : Math.min(open, close);

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