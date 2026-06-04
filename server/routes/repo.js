/**
 * 仓库路由 — /api/log 和 /api/diff
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runGit } from '../git-utils.js'
import { getCommitsWithDiff } from '../services/parser.js'

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

  const files = []
  for (const line of numstat.split('\n').filter(Boolean)) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const additions = parts[0] === '-' ? 0 : parseInt(parts[0])
    const deletions = parts[1] === '-' ? 0 : parseInt(parts[1])
    const path = parts[2]
    if (parts[0] === '-' && parts[1] === '-') continue
    files.push({ path, additions, deletions })
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