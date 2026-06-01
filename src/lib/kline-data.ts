import type { CandleData, CommitDiff, FileStock } from './types';

export function buildFileStocks(commits: CommitDiff[], repoId: string = ''): FileStock[] {
  // Track each file's state across commits (chronological order = oldest first)
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

  // commits are newest-first from git log, reverse for chronological order
  const chronological = [...commits].reverse();

  for (let i = 0; i < chronological.length; i++) {
    const diff = chronological[i];
    const { commit, files } = diff;

    for (const file of files) {
      let state = fileData.get(file.path);

      if (!state) {
        // New file - IPO
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

        // IPO candle: open = 0, close = lines after
        const open = 0;
        const close = Math.max(0, linesAfter);
        state.candles.push({
          time: commit.timestamp,
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
          volume: file.additions + file.deletions,
          commitMessage: commit.message,
          commitHash: commit.oid.slice(0, 8),
          author: commit.author,
        });
        state.currentLines = close;
        state.totalAdditions += file.additions;
        state.totalDeletions += file.deletions;
      } else {
        state.lastSeenIdx = i;
        const open = state.currentLines;
        const change = file.additions - file.deletions;
        const close = Math.max(0, open + change);

        state.candles.push({
          time: commit.timestamp,
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
          volume: file.additions + file.deletions,
          commitMessage: commit.message,
          commitHash: commit.oid.slice(0, 8),
          author: commit.author,
        });

        state.currentLines = close;
        state.totalAdditions += file.additions;
        state.totalDeletions += file.deletions;

        // Check if file was fully deleted (all lines removed)
        if (close === 0 && file.deletions > 0) {
          state.isDelisted = true;
        }
      }
    }
  }

  // Build FileStock objects
  const stocks: FileStock[] = [];

  for (const [, state] of fileData) {
    if (state.candles.length === 0) continue;

    const firstCandle = state.candles[0];
    const lastCandle = state.candles[state.candles.length - 1];

    // Calculate change percent from last candle
    const changePercent = lastCandle.open > 0
      ? ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100
      : (lastCandle.close > 0 ? 100 : 0);

    // Generate ticker from file path
    const ticker = generateTicker(state.path);

    let status: FileStock['status'] = 'active';
    if (state.candles.length === 1 || state.firstCommitIdx === chronological.length - 1) {
      status = 'ipo';
    }
    if (state.isDelisted) {
      status = 'delisted';
    }

    stocks.push({
      path: state.path,
      ticker,
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
      changePercent,
      repoId,
    });
  }

  // Sort by current lines (market cap) descending
  stocks.sort((a, b) => b.currentLines - a.currentLines);
  return stocks;
}

// Alias for backwards compatibility
export const buildFileStocksFromCommits = buildFileStocks;

function generateTicker(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  const name = filename.replace(/\.[^.]+$/, '').toUpperCase();
  const ext = filename.includes('.') ? filename.split('.').pop()!.toUpperCase() : '';

  // Truncate to max 6 chars for ticker style
  const shortName = name.slice(0, 6);
  return ext ? `${shortName}.${ext.slice(0, 3)}` : shortName;
}
