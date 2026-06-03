/**
 * 共享类型定义（JSDoc）
 * 与 src/lib/types.ts 保持同步
 *
 * @typedef {Object} CommitInfo
 * @property {string} oid - commit hash
 * @property {string} message - commit message
 * @property {string} author - author name
 * @property {number} timestamp - unix timestamp
 *
 * @typedef {Object} FileChange
 * @property {string} path - file path
 * @property {number} additions - lines added
 * @property {number} deletions - lines deleted
 *
 * @typedef {Object} CommitDiff
 * @property {CommitInfo} commit
 * @property {FileChange[]} files
 *
 * @typedef {Object} CandleData
 * @property {number} time - commit timestamp (seconds)
 * @property {number} open - lines before commit
 * @property {number} high - max(open, close)
 * @property {number} low - min(open, close)
 * @property {number} close - lines after commit
 * @property {number} volume - additions + deletions
 * @property {string} commitMessage
 * @property {string} commitHash
 * @property {string} author
 *
 * @typedef {Object} FileStock
 * @property {string} path - full file path
 * @property {string} ticker - stock ticker symbol
 * @property {CandleData[]} candles - K-line data
 * @property {number} currentLines - current line count
 * @property {'active'|'ipo'|'delisted'} status
 * @property {CommitInfo} firstCommit
 * @property {CommitInfo} [lastCommit]
 * @property {number} totalAdditions
 * @property {number} totalDeletions
 * @property {number} changePercent
 * @property {string} repoId
 *
 * @typedef {Object} CacheEntry
 * @property {string} repoName
 * @property {string} repoPath
 * @property {string|null} lastHead
 * @property {FileStock[]} stocks
 * @property {number} commitCount
 * @property {number} timestamp
 */

// This file is for documentation only — the types are defined via JSDoc above.
export {}