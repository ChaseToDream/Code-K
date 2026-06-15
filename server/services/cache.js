/**
 * 磁盘缓存管理 — 持久化解析结果避免重复解析
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGit } from '../git-utils.js'

/**
 * 缓存数据结构版本。当 K 线数据语义发生不兼容变更（如影线 high/low 计算方式改变）时递增，
 * 旧版本缓存会被自动视为未命中，触发重新解析，避免展示陈旧数据。
 * 需与前端 src/lib/cache.ts 的 CACHE_SCHEMA_VERSION 保持一致。
 */
export const CACHE_SCHEMA_VERSION = 2

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, '..', 'cache')

// 确保缓存目录存在
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true })
}

/**
 * 获取缓存文件路径
 */
function getCachePath(repoId) {
  return join(CACHE_DIR, `${repoId}.json`)
}

/**
 * 获取仓库当前 HEAD
 * @param {string} repoPath
 * @returns {Promise<string|null>}
 */
export async function getHeadCommit(repoPath) {
  try {
    const output = await runGit(repoPath, ['rev-parse', 'HEAD'])
    return output.trim()
  } catch {
    return null
  }
}

/**
 * 读取缓存
 * @param {string} repoId
 * @returns {{repoName: string, repoPath: string, lastHead: string|null, stocks: any[], commitCount: number, timestamp: number, schemaVersion?: number}|null} 缓存数据或 null
 */
export function loadCache(repoId) {
  const cachePath = getCachePath(repoId)
  try {
    if (!existsSync(cachePath)) return null
    const raw = readFileSync(cachePath, 'utf-8')
    const data = JSON.parse(raw)
    // 缓存过期检查（7天）
    if (Date.now() - data.timestamp > 7 * 24 * 60 * 60 * 1000) {
      unlinkSync(cachePath)
      return null
    }
    // schemaVersion 不匹配时视为未命中，触发上层重新解析
    if (data.schemaVersion !== CACHE_SCHEMA_VERSION) {
      console.warn(
        `[Cache] schemaVersion mismatch for ${repoId} (cached=${data.schemaVersion}, expected=${CACHE_SCHEMA_VERSION}), invalidating`
      )
      try { unlinkSync(cachePath) } catch { /* ignore */ }
      return null
    }
    return data
  } catch {
    return null
  }
}

/**
 * 写入缓存
 * @param {string} repoId
 * @param {{repoName: string, repoPath: string, lastHead: string|null, stocks: any[], commitCount: number}} data
 */
export function saveCache(repoId, data) {
  const cachePath = getCachePath(repoId)
  try {
    writeFileSync(cachePath, JSON.stringify({
      ...data,
      schemaVersion: CACHE_SCHEMA_VERSION,
      timestamp: Date.now(),
    }, null, 2), { encoding: 'utf-8', mode: 0o600 })
    console.log(`[Cache] Saved: ${repoId} (${data.commitCount} commits, ${data.stocks.length} stocks)`)
  } catch (err) {
    console.error(`[Cache] Failed to save ${repoId}:`, err.message)
  }
}

/**
 * 删除指定仓库缓存
 */
export function deleteCache(repoId) {
  const cachePath = getCachePath(repoId)
  try {
    if (existsSync(cachePath)) {
      unlinkSync(cachePath)
      console.log(`[Cache] Deleted: ${repoId}`)
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * 清理所有缓存
 */
export function clearAllCache() {
  try {
    const files = readdirSync(CACHE_DIR)
    let count = 0
    for (const file of files) {
      if (file.endsWith('.json')) {
        unlinkSync(join(CACHE_DIR, file))
        count++
      }
    }
    console.log(`[Cache] Cleared ${count} cache files`)
    return count
  } catch {
    return 0
  }
}

/**
 * 获取缓存统计
 */
export function getCacheStats() {
  try {
    const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'))
    let totalSize = 0
    for (const file of files) {
      totalSize += readFileSync(join(CACHE_DIR, file)).length
    }
    return { count: files.length, totalSize }
  } catch {
    return { count: 0, totalSize: 0 }
  }
}