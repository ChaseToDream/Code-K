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