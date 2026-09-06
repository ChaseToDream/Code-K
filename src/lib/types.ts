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
  additions: number;  // 本次 commit 新增行数
  deletions: number;  // 本次 commit 删除行数
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
  estimatedTimeRemaining?: number; // 秒
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
  /** 预计剩余时间（秒），仅 building 阶段携带 */
  estimatedTimeRemaining?: number;
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
  /** true 表示结果来自服务端磁盘缓存（HEAD 未变化） */
  fromCache?: boolean;
}

export interface ErrorMessage {
  type: 'error';
  repoId?: string;
  message: string;
  code: 'INVALID_REPO' | 'PARSE_FAILED' | 'NETWORK_ERROR' | 'UNKNOWN_TYPE' | 'PROCESSING_ERROR' | 'DIFF_FAILED';
}

export interface DiffDetailMessage {
  type: 'diff_detail';
  repoPath: string;
  commitHash: string;
  filePath: string;
  oldContent: string | null;
  newContent: string | null;
  additions: number;
  deletions: number;
  /** 二进制文件无法提供文本内容时置 true（oldContent/newContent 为 null） */
  isBinary?: boolean;
  /** git 操作失败时的错误信息（不击穿 WebSocket 连接） */
  error?: string;
}

export interface ParseStartedMessage {
  type: 'parse_started';
  repoId: string;
  repoName: string;
}

export interface ParseStoppedMessage {
  type: 'parse_stopped';
  /** 被停止的仓库 ID；旧协议不带 repoPath 的 stop_parse 且无任务在跑时可能缺失 */
  repoId?: string;
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
  /** 指定后只停止该仓库的解析；缺省时停止该连接上的所有解析任务 */
  repoPath?: string;
}

export interface RequestDiffDetail {
  type: 'request_diff';
  repoPath: string;
  commitHash: string;
  filePath: string;
}

export type ClientMessage = StartParseMessage | StopParseMessage | RequestDiffDetail;
