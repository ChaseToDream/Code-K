/**
 * 仓库路由 — /api/log 和 /api/diff
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runGit } from '../git-utils.js'
import { getCommitsWithDiff } from '../services/parser.js'
import { parseNumstat } from '../lib/numstat-parser.js'
import { createTaggedLogger } from '../lib/logger.js'

const logger = createTaggedLogger('DiffRoute')

/**
 * GET /api/log?path=<repo>&limit=N
 * 获取仓库提交列表
 */
export async function handleGetLog(req, res, repoPath) {
  const limit = new URL(req.url, `http://${req.headers.host}`).searchParams.get('limit') || '300'
  const commits = await getCommitsWithDiff(repoPath, parseInt(limit))
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(commits.map(c => ({
    hash: c.commit.oid,
    author: c.commit.author,
    timestamp: c.commit.timestamp,
    message: c.commit.message,
  }))))
}

/**
 * GET /api/diff?path=<repo>&hash=<hash>&parentHash=<hash>
 * 获取某次 commit 的文件变更
 */
export async function handleGetDiff(req, res, repoPath) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const hash = url.searchParams.get('hash')
  const parentHash = url.searchParams.get('parentHash')

  let numstat
  if (!parentHash) {
    numstat = await runGit(repoPath, ['diff-tree', '--numstat', '--root', '-r', hash])
  } else {
    numstat = await runGit(repoPath, ['diff-tree', '--numstat', '-r', parentHash, hash])
  }

  // 使用统一解析器：支持重命名、二进制标记、Unicode 路径
  const allFiles = parseNumstat(numstat)
  const files = []
  let binarySkipped = 0
  for (const f of allFiles) {
    if (f.isBinary) {
      binarySkipped++
      logger.debug('skipped binary', { path: f.path, hash: hash.slice(0, 8) })
      continue
    }
    files.push({
      path: f.path,
      renamedFrom: f.renamedFrom,
      additions: f.additions,
      deletions: f.deletions,
    })
  }
  if (binarySkipped > 0) {
    logger.info('diff parsed', { hash: hash.slice(0, 8), files: files.length, binarySkipped })
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(files))
}

/**
 * 验证仓库路径有效性，无效时返回 400 响应
 * @returns {boolean} 是否有效
 */
export function validateRepoPath(req, res, repoPath) {
  if (!repoPath) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: '缺少路径参数' }))
    return false
  }
  if (!existsSync(join(repoPath, '.git'))) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: '不是有效的 Git 仓库' }))
    return false
  }
  return true
}