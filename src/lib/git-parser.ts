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
    logPrefix: 'git-parser',
    includeStartTime: false,
    checkEmptyCommits: true
  })
}
