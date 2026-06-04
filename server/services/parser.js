/**
 * Git 解析器 — commit 读取与 K 线构建
 */
import { runGit } from '../git-utils.js'
import { generateRepoId, generateTicker, createCandle, calcChangePercent } from '../lib/kline-core.js'

/**
 * 用单次 git log 获取 commit 列表及每个 commit 的文件变更统计
 * --first-parent: 只沿第一父提交走，形成严格单链
 * --numstat: 直接输出每个 commit 的增删行数
 * --reverse: 按时间正序输出（旧 -> 新），与 buildFileStocks 一致
 *
 * @param {string} repoPath - Git 仓库路径
 * @param {number} [limit=300] - 最大 commit 数量
 * @returns {Promise<{commit: {oid: string, author: string, timestamp: number, message: string}, files: {path: string, additions: number, deletions: number}[]}[]>}
 */
export async function getCommitsWithDiff(repoPath, limit = 300) {
  const logOutput = await runGit(repoPath, [
    'log', `--max-count=${limit}`,
    '--first-parent',
    '--numstat',
    '--reverse',
    '--format=%H%x00%an%x00%at%x00%s',
  ])

  const commits = []
  let currentCommit = null
  let currentFiles = []

  for (const line of logOutput.split('\n')) {
    if (!line.trim()) {
      if (currentCommit) {
        commits.push({ commit: currentCommit, files: currentFiles })
        currentCommit = null
        currentFiles = []
      }
      continue
    }

    if (line.includes('\0')) {
      const [hash, author, timestamp, message] = line.split('\0')
      currentCommit = {
        oid: hash,
        author,
        timestamp: parseInt(timestamp),
        message,
      }
    } else {
      const parts = line.split('\t')
      if (parts.length < 3) continue
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0])
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1])
      const path = parts[2]
      if (parts[0] === '-' && parts[1] === '-') continue
      currentFiles.push({ path, additions, deletions })
    }
  }

  if (currentCommit) {
    commits.push({ commit: currentCommit, files: currentFiles })
  }

  return commits
}

/**
 * 构建文件股票数据
 * commits 需按时间正序排列（git log --reverse 的输出）
 *
 * @param {{commit: {oid: string, author: string, timestamp: number, message: string}, files: {path: string, additions: number, deletions: number}[]}[]} commits
 * @param {string} repoId
 * @returns {{path: string, ticker: string, candles: any[], currentLines: number, status: string, firstCommit: object, lastCommit: object, totalAdditions: number, totalDeletions: number, changePercent: number, repoId: string}[]}
 */
export function buildFileStocks(commits, repoId) {
  const fileData = new Map()

  // commits 已由 git log --reverse 保证时间正序排列
  const chronological = commits

  for (let i = 0; i < chronological.length; i++) {
    const diff = chronological[i]
    const { commit, files } = diff

    for (const file of files) {
      let state = fileData.get(file.path)

      if (!state) {
        // IPO：新文件首次出现
        const linesAfter = file.additions - file.deletions
        state = {
          path: file.path,
          candles: [],
          currentLines: 0,
          firstCommitIdx: i,
          lastSeenIdx: i,
          totalAdditions: 0,
          totalDeletions: 0,
          isDelisted: false,
        }
        fileData.set(file.path, state)

        const open = 0
        const close = Math.max(0, linesAfter)
        state.candles.push(createCandle(open, close, file.additions + file.deletions, commit))
        state.currentLines = close
        state.totalAdditions += file.additions
        state.totalDeletions += file.deletions
      } else {
        state.lastSeenIdx = i
        const open = state.currentLines
        const change = file.additions - file.deletions
        const close = Math.max(0, open + change)

        state.candles.push(createCandle(open, close, file.additions + file.deletions, commit))
        state.currentLines = close
        state.totalAdditions += file.additions
        state.totalDeletions += file.deletions

        if (close === 0 && file.deletions > 0) {
          state.isDelisted = true
        }
      }
    }
  }

  const stocks = []

  for (const [, state] of fileData) {
    if (state.candles.length === 0) continue

    const firstCandle = state.candles[0]
    const lastCandle = state.candles[state.candles.length - 1]

    let status = 'active'
    if (state.candles.length === 1 || state.firstCommitIdx === chronological.length - 1) {
      status = 'ipo'
    }
    if (state.isDelisted) {
      status = 'delisted'
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
    })
  }

  stocks.sort((a, b) => b.currentLines - a.currentLines)
  return stocks
}

