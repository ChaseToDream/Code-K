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
  oldContent?: string;
  newContent?: string;
  /** 重命名来源路径（当 git numstat 检测到文件移动/重命名时填充） */
  renamedFrom?: string;
  /** 标记为二进制文件（无行数可统计，不生成 K 线） */
  isBinary?: boolean;
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
  oldContent?: string;
  newContent?: string;
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
  repoId: string;        // 所属仓库ID
}

export interface ParseProgress {
  phase: 'reading' | 'parsing' | 'diffing' | 'building';
  current: number;
  total: number;
  message: string;
  currentFile?: string;
  estimatedTimeRemaining?: number; // 毫秒
  startTime?: number;
}

// 仓库信息
export interface RepoInfo {
  id: string;        // 唯一标识
  path: string;
  name: string;
  status: 'idle' | 'parsing' | 'ready' | 'error';
  progress?: ParseProgress;
  stocks: FileStock[];
  error?: string;
  /** 解析模式：local = 浏览器端 isomorphic-git；backend = WebSocket 后端 */
  parseMode?: 'local' | 'backend';
  /** 本地解析模式的目录句柄（parseMode === 'local' 时存在，用于刷新） */
  dirHandle?: FileSystemDirectoryHandle;
}

// 提交详情（用于diff查看）
export interface CommitDetail {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
  files: FileDiffDetail[];
}

export interface FileDiffDetail {
  path: string;
  additions: number;
  deletions: number;
  oldContent?: string;
  newContent?: string;
}

// WebSocket 消息类型
export interface ProgressMessage {
  type: 'progress';
  repoId: string;
  phase: 'reading' | 'parsing' | 'diffing' | 'building';
  current: number;
  total: number;
  message: string;
}

export interface PartialResultMessage {
  type: 'partial';
  repoId: string;
  stocks: FileStock[];
  latestCommit: CommitDiff;
}

export interface CompleteMessage {
  type: 'complete';
  repoId: string;
  repoName: string;
  stocks: FileStock[];
  totalCommits: number;
  totalTime: number;
}

export interface ErrorMessage {
  type: 'error';
  repoId?: string;
  message: string;
  code: 'INVALID_REPO' | 'PARSE_FAILED' | 'NETWORK_ERROR' | 'UNKNOWN_TYPE' | 'PROCESSING_ERROR' | 'DIFF_FAILED';
}

export interface DiffDetailMessage {
  type: 'diff_detail';
  commitHash: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  additions: number;
  deletions: number;
}

export interface ParseStartedMessage {
  type: 'parse_started';
  repoId: string;
  repoName: string;
}

export interface ParseStoppedMessage {
  type: 'parse_stopped';
}

export interface CommitsUpdateMessage {
  type: 'commits_update';
  repoId: string;
  repoName: string;
  commits: CommitDiff[];
  newHead: string;
}

export type ServerMessage = ProgressMessage | PartialResultMessage | CompleteMessage | ErrorMessage | DiffDetailMessage | ParseStartedMessage | ParseStoppedMessage | CommitsUpdateMessage;

export interface StartParseMessage {
  type: 'start_parse';
  repoPath: string;
  repoName: string;
  maxCommits?: number;
}

export interface StopParseMessage {
  type: 'stop_parse';
}

export interface RequestDiffDetail {
  type: 'request_diff';
  repoPath: string;
  commitHash: string;
  filePath: string;
}

export type ClientMessage = StartParseMessage | StopParseMessage | RequestDiffDetail;
