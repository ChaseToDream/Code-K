/**
 * 仓库发现路由 — /api/discover 和 /api/resolve
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { findRepos, resolveRepoByName } from '../services/scanner.js'

/**
 * GET /api/discover?path=<custom>
 * 扫描常见目录的 Git 仓库
 */
export async function handleDiscover(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const customPath = url.searchParams.get('path')

  let scanDirs = [
    homedir(),
    process.env.USERPROFILE || '',
    join(process.env.USERPROFILE || '', 'Desktop'),
    join(process.env.USERPROFILE || '', 'Documents'),
    process.env.HOME || '',
  ].filter(Boolean)

  if (customPath) {
    scanDirs = [customPath]
  }

  const uniqueDirs = [...new Set(scanDirs)]
  const allRepos = []
  for (const dir of uniqueDirs) {
    if (existsSync(dir)) {
      allRepos.push(...findRepos(dir))
    }
  }

  const seen = new Set()
  const uniqueRepos = allRepos.filter((r) => {
    if (seen.has(r.path)) return false
    seen.add(r.path)
    return true
  })

  res.json({ repos: uniqueRepos })
}

/**
 * GET /api/resolve?name=<folder_name>
 * 按文件夹名搜索 Git 仓库
 */
export async function handleResolve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const name = url.searchParams.get('name')
  if (!name) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: '缺少文件夹名' }))
  }

  const searchRoots = [
    join(process.env.USERPROFILE || homedir(), 'code'),
    join(process.env.USERPROFILE || homedir(), 'Code'),
    join(process.env.USERPROFILE || homedir(), 'projects'),
    join(process.env.USERPROFILE || homedir(), 'Projects'),
    join(process.env.USERPROFILE || homedir(), 'workspace'),
    join(process.env.USERPROFILE || homedir(), 'Workspace'),
    join(process.env.USERPROFILE || homedir(), 'dev'),
    join(process.env.USERPROFILE || homedir(), 'Dev'),
    join(process.env.USERPROFILE || homedir(), 'source'),
    join(process.env.USERPROFILE || homedir(), 'Source'),
    join(process.env.USERPROFILE || homedir(), 'Desktop'),
    join(process.env.USERPROFILE || homedir(), 'Documents'),
    'D:\\codeFile',
    'D:\\projects',
  ].filter(Boolean)

  const uniqueRoots = [...new Set(searchRoots)]
  const { results } = resolveRepoByName(name, uniqueRoots)

  res.json({ repos: results, searched: uniqueRoots.filter(r => existsSync(r)) })
}