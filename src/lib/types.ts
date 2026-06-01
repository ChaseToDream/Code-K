export interface CommitInfo {
  oid: string;
  message: string;
  author: string;
  timestamp: number;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface CommitDiff {
  commit: CommitInfo;
  files: FileChange[];
}

export interface CandleData {
  time: number;       // commit timestamp (seconds)
  open: number;       // lines before commit
  high: number;       // max(open, close)
  low: number;        // min(open, close)
  close: number;      // lines after commit
  volume: number;     // additions + deletions
  commitMessage: string;
  commitHash: string;
  author: string;
}

export interface FileStock {
  path: string;         // full path like "src/App.tsx"
  ticker: string;       // short ticker like "APP.TSX"
  candles: CandleData[];
  currentLines: number;
  status: 'active' | 'ipo' | 'delisted';
  firstCommit: CommitInfo;
  lastCommit?: CommitInfo;
  totalAdditions: number;
  totalDeletions: number;
  changePercent: number;  // latest candle change %
}

export interface ParseProgress {
  phase: 'reading' | 'parsing' | 'diffing' | 'building';
  current: number;
  total: number;
  message: string;
}
