import type { CandleData, CommitDiff, FileStock } from './types';
import { generateTicker, createCandle, calcChangePercent } from './kline-core';

/**
 * 从 commit 列表构建文件股票数据（全量构建）
 * 专用场景：浏览器端 FileSystemDirectoryHandle 本地解析流程（useLocalParser）
 * ⚠️ 警告：此函数与 server/services/parser.js 的 buildFileStocks 逻辑需保持同步
 */
export function buildFileStocks(commits: CommitDiff[], repoId: string = ''): FileStock[] {
  const fileData = new Map<string, {
    path: string;
    candles: CandleData[];
    currentLines: number;
    firstCommitIdx: number;
    lastSeenIdx: number;
    totalAdditions: number;
    totalDeletions: number;
    isDelisted: boolean;
  }>();

  // commits 需按时间正序排列（旧 -> 新），调用方负责保证
  const chronological = commits;

  for (let i = 0; i < chronological.length; i++) {
    const diff = chronological[i];
    const { commit, files } = diff;

    for (const file of files) {
      let state = fileData.get(file.path);

      if (!state) {
        // IPO：新文件首次出现
        const linesAfter = file.additions - file.deletions;
        state = {
          path: file.path,
          candles: [],
          currentLines: 0,
          firstCommitIdx: i,
          lastSeenIdx: i,
          totalAdditions: 0,
          totalDeletions: 0,
          isDelisted: false,
        };
        fileData.set(file.path, state);

        const open = 0;
        const close = Math.max(0, linesAfter);
        state.candles.push(createCandle(open, close, file.additions + file.deletions, commit));
        state.currentLines = close;
        state.totalAdditions += file.additions;
        state.totalDeletions += file.deletions;
      } else {
        state.lastSeenIdx = i;
        const open = state.currentLines;
        const change = file.additions - file.deletions;
        const close = Math.max(0, open + change);

        state.candles.push(createCandle(open, close, file.additions + file.deletions, commit));
        state.currentLines = close;
        state.totalAdditions += file.additions;
        state.totalDeletions += file.deletions;

        if (close === 0 && file.deletions > 0) {
          state.isDelisted = true;
        }
      }
    }
  }

  const stocks: FileStock[] = [];

  for (const [, state] of fileData) {
    if (state.candles.length === 0) continue;

    const firstCandle = state.candles[0];
    const lastCandle = state.candles[state.candles.length - 1];

    let status: FileStock['status'] = 'active';
    if (state.candles.length === 1 || state.firstCommitIdx === chronological.length - 1) {
      status = 'ipo';
    }
    if (state.isDelisted) {
      status = 'delisted';
    }

    stocks.push({
      path: state.path,
      ticker: generateTicker(state.path),
      candles: state.candles,
      currentLines: state.currentLines,
      status,
      firstCommit: {
        oid: firstCandle.commitHash,
        message: firstCandle.commitMessage,
        author: firstCandle.author,
        timestamp: firstCandle.time,
      },
      lastCommit: {
        oid: lastCandle.commitHash,
        message: lastCandle.commitMessage,
        author: lastCandle.author,
        timestamp: lastCandle.time,
      },
      totalAdditions: state.totalAdditions,
      totalDeletions: state.totalDeletions,
      changePercent: calcChangePercent(lastCandle),
      repoId,
    });
  }

  stocks.sort((a, b) => b.currentLines - a.currentLines);
  return stocks;
}

// 别名，保持向后兼容
export const buildFileStocksFromCommits = buildFileStocks;