import { useCallback, useRef } from 'react'
import { useAppContext } from './useAppContext'
import { buildFileStocks, normalizeStocksCandles } from '../lib/kline-data'
import { generateRepoId } from '../lib/kline-core'
import { getCachedRepo, setCachedRepo, deleteCachedRepo, CACHE_SCHEMA_VERSION } from '../lib/cache'
import type { CommitDiff, ParseProgress } from '../lib/types'

/** git-core 产出的 ETA 单位为毫秒，统一转换为秒（与后端协议一致） */
function normalizeProgress(progress: ParseProgress): ParseProgress {
  if (progress.estimatedTimeRemaining === undefined) return progress
  return {
    ...progress,
    estimatedTimeRemaining: Math.max(0, Math.round(progress.estimatedTimeRemaining / 1000)),
  }
}

/** 写入 IndexedDB 前剥离每个 commit 每个 file 的全文内容，防止大仓库超配额 */
function stripContentsForCache(commits: CommitDiff[]): CommitDiff[] {
  return commits.map(diff => ({
    ...diff,
    files: diff.files.map(file => {
      const stripped = { ...file }
      delete stripped.oldContent
      delete stripped.newContent
      return stripped
    }),
  }))
}

export function useLocalParser() {
  const { dispatch } = useAppContext()
  // 每个本地仓库一个 Worker（按 repoId 索引）
  const workersRef = useRef(new Map<string, Worker>())
  // 每个本地仓库的目录句柄（按 repoId 索引），供刷新时复用
  const dirHandlesRef = useRef(new Map<string, FileSystemDirectoryHandle>())

  /**
   * 核心：用 Worker 解析本地仓库（跳过缓存，强制重新解析）
   * 被首次解析与刷新复用；同一 repoId 重复调用时终止旧 Worker 重开
   */
  const runWorkerParse = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
    const repoName = dirHandle.name
    const repoId = generateRepoId(repoName)

    // 终止该仓库之前的 Worker
    workersRef.current.get(repoId)?.terminate()

    // 创建新的 Worker
    const worker = new Worker(
      new URL('../lib/git-worker.ts', import.meta.url),
      { type: 'module' }
    )
    workersRef.current.set(repoId, worker)

    const allCommits: CommitDiff[] = []

    worker.onmessage = async (e: MessageEvent) => {
      const { type, progress, commits, error } = e.data

      switch (type) {
        case 'progress':
          dispatch({
            type: 'UPDATE_REPO_PROGRESS',
            repoId,
            progress: normalizeProgress(progress as ParseProgress),
          })
          break

        case 'partial':
          if (commits && commits.length > 0) {
            allCommits.length = 0
            allCommits.push(...commits)
            // Worker 输出的 commits 是逆序（新->旧），需要反转
            const stocks = buildFileStocks([...allCommits].reverse(), repoId)
            dispatch({
              type: 'UPDATE_REPO_STOCKS',
              repoId,
              stocks,
            })
          }
          break

        case 'complete':
          if (commits && commits.length > 0) {
            allCommits.length = 0
            allCommits.push(...commits)
            // Worker 输出的 commits 是逆序（新->旧），需要反转
            const finalStocks = buildFileStocks([...allCommits].reverse(), repoId)
            dispatch({
              type: 'UPDATE_REPO_STOCKS',
              repoId,
              stocks: finalStocks,
            })

            // 缓存解析结果（失败不影响主流程）
            // commits 写入前剥离 oldContent/newContent 全文；candle 上的内容保留在内存不剥离
            try {
              await setCachedRepo({
                id: repoId,
                name: repoName,
                path: repoName,
                stocks: finalStocks,
                commits: stripContentsForCache(allCommits),
                timestamp: Date.now(),
                commitCount: allCommits.length,
                schemaVersion: CACHE_SCHEMA_VERSION,
              })
              console.log('[Cache] Saved to cache:', repoName)
            } catch (cacheErr) {
              console.warn('[Cache] 缓存保存失败:', (cacheErr as Error)?.message)
            }
          }
          dispatch({
            type: 'SET_REPO_STATUS',
            repoId,
            status: 'ready',
          })
          worker.terminate()
          workersRef.current.delete(repoId)
          break

        case 'error':
          dispatch({
            type: 'SET_REPO_STATUS',
            repoId,
            status: 'error',
            error: error || '解析失败',
          })
          worker.terminate()
          workersRef.current.delete(repoId)
          break
      }
    }

    worker.onerror = () => {
      dispatch({
        type: 'SET_REPO_STATUS',
        repoId,
        status: 'error',
        error: 'Worker 错误',
      })
      worker.terminate()
      workersRef.current.delete(repoId)
    }

    // 发送解析任务到 Worker
    worker.postMessage({
      type: 'parse',
      dirHandle,
      maxCommits: 300,
    })
  }, [dispatch])

  const parseLocalRepo = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
    const repoName = dirHandle.name
    const repoId = generateRepoId(repoName)
    dirHandlesRef.current.set(repoId, dirHandle)

    // 创建仓库记录 —— 标记为本地解析模式，保存 dirHandle 供刷新复用
    dispatch({
      type: 'ADD_REPO',
      repo: {
        id: repoId,
        path: repoName,
        name: repoName,
        status: 'parsing',
        stocks: [],
        parseMode: 'local',
        dirHandle,
      },
    })

    // 尝试从缓存加载，缓存异常时静默跳过
    let cached: Awaited<ReturnType<typeof getCachedRepo>> | null
    try {
      cached = await getCachedRepo(repoId)
    } catch (cacheErr) {
      console.warn('[Cache] 缓存读取失败，跳过缓存:', (cacheErr as Error)?.message)
      cached = null
    }
    if (cached && cached.stocks.length > 0) {
      console.log('[Cache] Loading from cache:', repoName)
      dispatch({
        type: 'UPDATE_REPO_STOCKS',
        repoId,
        // 旧缓存的 candle 可能缺 additions/deletions，兜底为 0
        stocks: normalizeStocksCandles(cached.stocks),
      })
      dispatch({
        type: 'SET_REPO_STATUS',
        repoId,
        status: 'ready',
      })
      return
    }

    // 缓存未命中，启动 Worker 解析
    await runWorkerParse(dirHandle)
  }, [dispatch, runWorkerParse])

  /**
   * 刷新本地解析的仓库：清除该仓库缓存后用 Worker 重新解析（repoId 保持稳定）
   * @returns true 表示该仓库是本地模式且已触发刷新；false 表示未命中本地句柄
   */
  const refreshLocalRepo = useCallback(async (repoId: string): Promise<boolean> => {
    const dirHandle = dirHandlesRef.current.get(repoId)
    if (!dirHandle) {
      return false
    }

    // 清除该仓库的缓存，确保重新解析而非命中旧缓存
    try {
      await deleteCachedRepo(repoId)
    } catch {
      // 缓存删除失败不影响刷新
    }

    dispatch({ type: 'SET_REPO_STATUS', repoId, status: 'parsing' })
    await runWorkerParse(dirHandle)
    return true
  }, [dispatch, runWorkerParse])

  /**
   * 停止指定本地仓库的解析：终止其 Worker 并清理句柄（无对应记录时为 no-op）
   */
  const stopLocalParse = useCallback((repoId: string) => {
    const worker = workersRef.current.get(repoId)
    if (worker) {
      worker.terminate()
      workersRef.current.delete(repoId)
    }
    dirHandlesRef.current.delete(repoId)
  }, [])

  return {
    parseLocalRepo,
    refreshLocalRepo,
    stopLocalParse,
  }
}
