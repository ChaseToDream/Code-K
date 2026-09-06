/**
 * 仓库路由 — /api/log
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
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