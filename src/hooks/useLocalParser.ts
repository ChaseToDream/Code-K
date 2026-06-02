import { useCallback, useRef } from 'react'
import { useAppContext } from './useAppContext'
import { buildFileStocks } from '../lib/kline-data'
import type { CommitDiff } from '../lib/types'

export function useLocalParser() {
  const { dispatch } = useAppContext()
  const workerRef = useRef<Worker | null>(null)

  const parseLocalRepo = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
    const repoName = dirHandle.name
    const repoId = btoa(repoName).slice(0, 12)

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

    worker.onmessage = (e: MessageEvent) => {
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
            const stocks = buildFileStocks(allCommits, repoId)
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
            const finalStocks = buildFileStocks(allCommits, repoId)
            dispatch({
              type: 'UPDATE_REPO_STOCKS',
              repoId,
              stocks: finalStocks,
            })
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
