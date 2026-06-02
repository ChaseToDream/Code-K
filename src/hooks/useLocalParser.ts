import { useCallback, useRef } from 'react'
import { useAppContext } from './useAppContext'
import { parseGitRepo } from '../lib/git-parser'
import { buildFileStocks } from '../lib/kline-data'
import type { CommitDiff } from '../lib/types'

export function useLocalParser() {
  const { dispatch } = useAppContext()
  const abortRef = useRef<boolean>(false)

  const parseLocalRepo = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
    const repoName = dirHandle.name
    const repoId = btoa(repoName).slice(0, 12)

    // 创建仓库记录
    dispatch({
      type: 'ADD_REPO',
      repo: {
        id: repoId,
        path: repoName, // 使用文件夹名称作为标识
        name: repoName,
        status: 'parsing',
        stocks: [],
      },
    })

    abortRef.current = false

    try {
      const allCommits: CommitDiff[] = []

      await parseGitRepo(
        dirHandle,
        (progress) => {
          if (abortRef.current) return
          dispatch({
            type: 'UPDATE_REPO_PROGRESS',
            repoId,
            progress,
          })
        },
        300,
        allCommits,
        (partialCommits) => {
          if (abortRef.current) return
          const stocks = buildFileStocks(partialCommits, repoId)
          dispatch({
            type: 'UPDATE_REPO_STOCKS',
            repoId,
            stocks,
          })
        }
      )

      if (!abortRef.current) {
        const finalStocks = buildFileStocks(allCommits, repoId)
        dispatch({
          type: 'UPDATE_REPO_STOCKS',
          repoId,
          stocks: finalStocks,
        })
        dispatch({
          type: 'SET_REPO_STATUS',
          repoId,
          status: 'ready',
        })
      }
    } catch (error) {
      if (!abortRef.current) {
        dispatch({
          type: 'SET_REPO_STATUS',
          repoId,
          status: 'error',
          error: error instanceof Error ? error.message : '解析失败',
        })
      }
    }
  }, [dispatch])

  const stopParsing = useCallback(() => {
    abortRef.current = true
  }, [])

  return {
    parseLocalRepo,
    stopParsing,
  }
}
