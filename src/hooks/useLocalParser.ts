import { useCallback, useRef } from 'react'
import { useAppContext } from './useAppContext'
import { buildFileStocks } from '../lib/kline-data'
import { generateRepoId } from '../lib/kline-core'
import { getCachedRepo, setCachedRepo, deleteCachedRepo, CACHE_SCHEMA_VERSION } from '../lib/cache'
import type { CommitDiff } from '../lib/types'

export function useLocalParser() {
  const { dispatch } = useAppContext()
  const workerRef = useRef<Worker | null>(null)
  // 保存最近一次解析的 dirHandle，供刷新时复用
  const lastDirHandleRef = useRef<FileSystemDirectoryHandle | null>(null)

  /**
   * 核心：用 Worker 解析本地仓库（跳过缓存，强制重新解析）
   * 被首次解析与刷新复用
   */
  const runWorkerParse = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
    const repoName = dirHandle.name
    const repoId = generateRepoId(repoName)

    // 终止之前的 Worker
    if (workerRef.current) {
      workerRef.current.terminate()
    }

    // 创建新的 Worker
    const worker = new Worker(
      new URL('../lib/git-worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    const allCommits: CommitDiff[] = []

    worker.onmessage = async (e: MessageEvent) => {
      const { type, progress, commits, error } = e.data

      switch (type) {
        case 'progress':
          dispatch({
            type: 'UPDATE_REPO_PROGRESS',
            repoId,
            progress,
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
            try {
              await setCachedRepo({
                id: repoId,
                name: repoName,
                path: repoName,
                stocks: finalStocks,
                commits: allCommits,
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
          workerRef.current = null
          break

        case 'error':
          dispatch({
            type: 'SET_REPO_STATUS',
            repoId,
            status: 'error',
            error: error || '解析失败',
          })
          worker.terminate()
          workerRef.current = null
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
      workerRef.current = null
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
    lastDirHandleRef.current = dirHandle

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

    // 尝试从缓存加载（兼容旧版 btoa 生成的 repoId），缓存异常时静默跳过
    let cached: Awaited<ReturnType<typeof getCachedRepo>> | null
    try {
      cached = await getCachedRepo(repoId)
      if (!cached) {
        const legacyRepoId = btoa(repoName).slice(0, 12)
        cached = await getCachedRepo(legacyRepoId)
        if (cached) {
          console.log('[Cache] Migrated from legacy cache:', repoName)
          // 用新 repoId 重新保存缓存
          await setCachedRepo({ ...cached, id: repoId, schemaVersion: CACHE_SCHEMA_VERSION })
          await deleteCachedRepo(legacyRepoId)
        }
      }
    } catch (cacheErr) {
      console.warn('[Cache] 缓存读取失败，跳过缓存:', (cacheErr as Error)?.message)
      cached = null
    }
    if (cached && cached.stocks.length > 0) {
      console.log('[Cache] Loading from cache:', repoName)
      dispatch({
        type: 'UPDATE_REPO_STOCKS',
        repoId,
        stocks: cached.stocks,
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
   * 刷新本地解析的仓库：清除该仓库缓存后用 Worker 重新解析
   * @returns true 表示该仓库是本地模式且已触发刷新；false 表示非本地模式，调用方应走 WebSocket
   */
  const refreshLocalRepo = useCallback(async (repoId: string): Promise<boolean> => {
    const dirHandle = lastDirHandleRef.current
    if (!dirHandle || generateRepoId(dirHandle.name) !== repoId) {
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

  const stopParsing = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
  }, [])

  return {
    parseLocalRepo,
    refreshLocalRepo,
    stopParsing,
  }
}
