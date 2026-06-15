/**
 * Git 解析器 — commit 读取与 K 线构建
 */
import { runGit } from '../git-utils.js'
import { generateRepoId, generateTicker, createCandle, calcChangePercent } from '../lib/kline-core.js'
import { parseNumstatLine } from '../lib/numstat-parser.js'
import { createTaggedLogger } from '../lib/logger.js'

const logger = createTaggedLogger('Parser')

/**
 * 用单次 git log 获取 commit 列表及每个 commit 的文件变更统计
 * --first-parent: 只沿第一父提交走，形成严格单链
 * --numstat: 直接输出每个 commit 的增删行数
 * --reverse: 按时间正序输出（旧 -> 新），与 buildFileStocks 一致
 *
 * 解析使用统一的 parseNumstatLine，支持重命名/移动、二进制文件标记、带引号的 Unicode 路径。
 * 二进制文件（git 输出 `-`/`-`）被跳过并记入 debug 日志，便于追溯"为何某文件未出现"。
 *
 * @param {string} repoPath - Git 仓库路径
 * @param {number} [limit=300] - 最大 commit 数量
 * @returns {Promise<{commit: {oid: string, author: string, timestamp: number, message: string}, files: {path: string, additions: number, deletions: number, renamedFrom?: string}[]}[]>}
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
  let binarySkipped = 0
  let renameCount = 0

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
      // commit 元信息行
      const [hash, author, timestamp, message] = line.split('\0')
      currentCommit = {
        oid: hash,
        author,
        timestamp: parseInt(timestamp),
        message,
      }
    } else {
      // numstat 文件变更行 —— 统一交给解析器
      const parsed = parseNumstatLine(line)
      if (!parsed) continue

      if (parsed.isBinary) {
        // 二进制文件无行数可统计，不生成 K 线，但记入日志便于追溯
        binarySkipped++
        logger.debug('skipped binary', { path: parsed.path, commit: currentCommit?.oid?.slice(0, 8) })
        continue
      }

      if (parsed.isRename) {
        renameCount++
        logger.debug('rename detected', {
          oldPath: parsed.renamedFrom,
          newPath: parsed.path,
          commit: currentCommit?.oid?.slice(0, 8),
        })
      }

      currentFiles.push({
        path: parsed.path,
        renamedFrom: parsed.renamedFrom,
        additions: parsed.additions,
        deletions: parsed.deletions,
      })
    }
  }

  if (currentCommit) {
    commits.push({ commit: currentCommit, files: currentFiles })
  }

  logger.info('parsed commits', {
    total: commits.length,
    binarySkipped,
    renameCount,
  })

  return commits
}

/**
 * 构建文件股票数据
 * commits 需按时间正序排列（git log --reverse 的输出）
 *
 * 重命名处理：当某次 commit 的 file 带 renamedFrom 时，把旧路径的 state（含全部历史 candles、
 * currentLines、累计增删）迁移到新路径，等价于"资产过户"——旧股票退市、新股继承全部历史。
 *
 * @param {{commit: {oid: string, author: string, timestamp: number, message: string}, files: {path: string, additions: number, deletions: number, renamedFrom?: string}[]}[]} commits
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
      // 重命名：把旧路径的 state 迁移到新路径（资产过户）
      if (file.renamedFrom && file.path !== file.renamedFrom) {
        const oldState = fileData.get(file.renamedFrom)
        if (oldState) {
          fileData.delete(file.renamedFrom)
          oldState.path = file.path
          fileData.set(file.path, oldState)
        }
      }

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
        state.candles.push(
          createCandle(open, close, file.additions + file.deletions, commit, {
            additions: file.additions,
            deletions: file.deletions,
          }),
        )
        state.currentLines = close
        state.totalAdditions += file.additions
        state.totalDeletions += file.deletions
      } else {
        state.lastSeenIdx = i
        const open = state.currentLines
        const change = file.additions - file.deletions
        const close = Math.max(0, open + change)

        state.candles.push(
          createCandle(open, close, file.additions + file.deletions, commit, {
            additions: file.additions,
            deletions: file.deletions,
          }),
        )
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
