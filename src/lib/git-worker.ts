import { parseGitRepo as coreParseGitRepo, WebFsAdapter, FakeStats } from './git-core'
import type { CommitDiff, ParseProgress } from './types'

type ProgressCallback = (progress: ParseProgress) => void
type CommitsCallback = (commits: CommitDiff[]) => void

export { WebFsAdapter, FakeStats }

export async function parseGitRepo(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: ProgressCallback,
  maxCommits = 300,
  resultCommits?: CommitDiff[],
  onPartialCommit?: CommitsCallback
): Promise<CommitDiff[]> {
  return coreParseGitRepo({
    dirHandle,
    onProgress,
    maxCommits,
    resultCommits,
    onPartialCommit,
    logPrefix: 'git-worker',
    includeStartTime: true,
    checkEmptyCommits: true
  })
}

self.onmessage = async (e: MessageEvent) => {
  const { type, dirHandle, maxCommits } = e.data

  if (type === 'parse') {
    try {
      const commits = await parseGitRepo(
        dirHandle,
        (progress) => {
          self.postMessage({ type: 'progress', progress })
        },
        maxCommits || 300,
        undefined,
        (partialCommits) => {
          self.postMessage({ type: 'partial', commits: partialCommits })
        }
      )

      self.postMessage({ type: 'complete', commits })
    } catch (error) {
      self.postMessage({ type: 'error', error: (error as Error).message })
    }
  }
}
