import { useCallback, useRef } from 'react'
import { useAppContext } from './useAppContext'
import { buildFileStocks } from '../lib/kline-data'
import { generateRepoId } from '../lib/kline-core'
import { getCachedRepo, setCachedRepo, deleteCachedRepo } from '../lib/cache'
import type { CommitDiff } from '../lib/types'

export function useLocalParser() {
  const { dispatch } = useAppContext()
  const workerRef = useRef<Worker | null>(null)

  const parseLocalRepo = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
    const repoName = dirHandle.name
    const repoId = generateRepoId(repoName)

    // 创建仓库记录
    dispatch({
      type: 'ADD_REPO',
      repo: {
        id: repoId,
        path: repoName,
        name: repoName,
        status: 'parsing',
        stocks: [],
      },
    })

    // 尝试从缓存加载（兼容旧版 btoa 生成的 repoId），缓存异常时静默跳过
    let cached: Awaited<ReturnType<typeof getCachedRepo>> | null = null
    try {
      cached = await getCachedRepo(repoId)
      if (!cached) {
        const legacyRepoId = btoa(repoName).slice(0, 12)
        cached = await getCachedRepo(legacyRepoId)
        if (cached) {
          console.log('[Cache] Migrated from legacy cache:', repoName)
          // 用新 repoId 重新保存缓存
          await setCachedRepo({ ...cached, id: repoId })
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

  const stopParsing = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
  }, [])

  return {
    parseLocalRepo,
    stopParsing,
  }
}
