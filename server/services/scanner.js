/**
 * 仓库扫描器 — 发现本地 Git 仓库
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 递归扫描目录下的 Git 仓库
 */
export function findRepos(dir, depth = 0, maxDepth = 2) {
  if (depth > maxDepth) return []
  const repos = []
  try {
    if (existsSync(join(dir, '.git'))) {
      repos.push({ path: dir, name: dir.split(/[\\/]/).filter(Boolean).pop() || dir })
      return repos
    }
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        try {
          const fullPath = join(dir, entry.name)
          statSync(fullPath)
          repos.push(...findRepos(fullPath, depth + 1, maxDepth))
        } catch { /* skip */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return repos
}

/**
 * 按文件夹名搜索 Git 仓库
 * 限制扫描深度和时间，避免卡死
 */
export function resolveRepoByName(name, searchRoots, maxResults = 10, maxScanTime = 5000) {
  const startTime = Date.now()
  const results = []

  function scanDir(dir, depth = 0, maxDepth = 2) {
    if (Date.now() - startTime > maxScanTime) return
    if (depth > maxDepth || results.length >= maxResults) return

    try {
      const dirName = dir.split(/[\\/]/).pop() || ''
      if (dirName.toLowerCase() === name.toLowerCase() && existsSync(join(dir, '.git'))) {
        results.push({ path: dir, name: dirName })
        return
      }
      if (results.length >= maxResults) return

      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (results.length >= maxResults || Date.now() - startTime > maxScanTime) break
        if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules') && !entry.name.startsWith('.git')) {
          try {
            scanDir(join(dir, entry.name), depth + 1, maxDepth)
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  for (const root of searchRoots) {
    if (results.length >= maxResults || Date.now() - startTime > maxScanTime) break
    if (existsSync(root)) scanDir(root)
  }

  return { results, elapsed: Date.now() - startTime }
}