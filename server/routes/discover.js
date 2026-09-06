/**
 * 仓库发现路由 — /api/discover
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { findRepos } from '../services/scanner.js'

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

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ repos: uniqueRepos }))
}