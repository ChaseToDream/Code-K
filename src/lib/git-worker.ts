import * as git from 'isomorphic-git'
import type { CommitDiff, CommitInfo, FileChange, ParseProgress } from './types'

type ProgressCallback = (progress: ParseProgress) => void
type CommitsCallback = (commits: CommitDiff[]) => void

// Minimal fs.Stats-compatible wrapper
class FakeStats {
  size: number
  mode: number
  mtimeMs: number
  private _isDir: boolean

  constructor(size: number, mode: number, mtimeMs: number, isDir: boolean) {
    this.size = size
    this.mode = mode
    this.mtimeMs = mtimeMs
    this._isDir = isDir
  }

  isDirectory(): boolean { return this._isDir }
  isFile(): boolean { return !this._isDir }
  isSymbolicLink(): boolean { return false }
}

// Custom FS adapter using File System Access API
class WebFsAdapter {
  private rootDir: FileSystemDirectoryHandle
  private dirCache = new Map<string, FileSystemDirectoryHandle>()

  constructor(rootDir: FileSystemDirectoryHandle) {
    this.rootDir = rootDir
    this.dirCache.set('/', rootDir)
    this.dirCache.set('.', rootDir)
  }

  private splitPath(filepath: string): string[] {
    return filepath.split('/').filter(Boolean)
  }

  private async getDirHandle(dirPath: string): Promise<FileSystemDirectoryHandle> {
    const normalized = '/' + dirPath.split('/').filter(Boolean).join('/')
    if (this.dirCache.has(normalized)) return this.dirCache.get(normalized)!

    const parts = this.splitPath(dirPath)
    let current = this.rootDir
    let built = ''
    for (const part of parts) {
      built += '/' + part
      if (this.dirCache.has(built)) {
        current = this.dirCache.get(built)!
      } else {
        current = await current.getDirectoryHandle(part, { create: false })
        this.dirCache.set(built, current)
      }
    }
    this.dirCache.set(normalized, current)
    return current
  }

  private async getParentAndName(filepath: string): Promise<[FileSystemDirectoryHandle, string]> {
    const parts = this.splitPath(filepath)
    const name = parts.pop()!
    const parentPath = parts.join('/')
    const parent = await this.getDirHandle(parentPath || '/')
    return [parent, name]
  }

  async readFile(filepath: string, options?: { encoding?: string }): Promise<Uint8Array | string> {
    const [dir, name] = await this.getParentAndName(filepath)
    const fileHandle = await dir.getFileHandle(name)
    const file = await fileHandle.getFile()
    if (options?.encoding === 'utf8') return await file.text()
    return new Uint8Array(await file.arrayBuffer())
  }

  async writeFile(filepath: string, data: Uint8Array | string): Promise<void> {
    const [dir, name] = await this.getParentAndName(filepath)
    const fileHandle = await dir.getFileHandle(name, { create: true })
    const writable = await (fileHandle as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable()
    await writable.write(data as string)
    await writable.close()
  }

  async mkdir(dirpath: string): Promise<void> {
    const parts = this.splitPath(dirpath)
    let current = this.rootDir
    let built = ''
    for (const part of parts) {
      built += '/' + part
      current = await current.getDirectoryHandle(part, { create: true })
      this.dirCache.set(built, current)
    }
  }

  async rmdir(dirpath: string): Promise<void> {
    const [dir, name] = await this.getParentAndName(dirpath)
    await (dir as unknown as { removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void> }).removeEntry(name, { recursive: true })
  }

  async readdir(dirpath: string): Promise<string[]> {
    const dir = await this.getDirHandle(dirpath)
    const entries: string[] = []
    for await (const entry of (dir as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) entries.push(entry[0])
    return entries
  }

  async stat(filepath: string): Promise<FakeStats> {
    try {
      const [dir, name] = await this.getParentAndName(filepath)
      const fileHandle = await dir.getFileHandle(name)
      const file = await fileHandle.getFile()
      return new FakeStats(file.size, 0o100644, file.lastModified, false)
    } catch {
      await this.getDirHandle(filepath)
      return new FakeStats(0, 0o40000, 0, true)
    }
  }

  async lstat(filepath: string): Promise<FakeStats> {
    return this.stat(filepath)
  }

  async readlink(): Promise<string> {
    throw new Error('readlink not supported')
  }

  async symlink(): Promise<void> {
    throw new Error('symlink not supported')
  }

  async chmod(): Promise<void> {}

  async unlink(filepath: string): Promise<void> {
    const [dir, name] = await this.getParentAndName(filepath)
    await (dir as unknown as { removeEntry: (name: string) => Promise<void> }).removeEntry(name)
  }

  get promises() {
    return {
      readFile: this.readFile.bind(this),
      writeFile: this.writeFile.bind(this),
      mkdir: this.mkdir.bind(this),
      rmdir: this.rmdir.bind(this),
      readdir: this.readdir.bind(this),
      stat: this.stat.bind(this),
      lstat: this.lstat.bind(this),
      readlink: this.readlink.bind(this),
      symlink: this.symlink.bind(this),
      chmod: this.chmod.bind(this),
      unlink: this.unlink.bind(this),
    }
  }
}

// Fast line diff
function fastDiff(oldText: string, newText: string): { additions: number; deletions: number } {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const m = oldLines.length
  const n = newLines.length

  if (m === n && oldLines.every((line, i) => line === newLines[i])) {
    return { additions: 0, deletions: 0 }
  }

  if (m * n <= 40_000) {
    return lcsDiff(oldLines, newLines, m, n)
  }

  const oldLineIndices = new Map<string, number[]>()
  for (let i = 0; i < m; i++) {
    const indices = oldLineIndices.get(oldLines[i])
    if (indices) indices.push(i)
    else oldLineIndices.set(oldLines[i], [i])
  }

  const matchedOld = new Set<number>()
  let lastOldIdx = 0

  for (let j = 0; j < n; j++) {
    const indices = oldLineIndices.get(newLines[j])
    if (indices) {
      const matchIdx = indices.find(i => i >= lastOldIdx)
      if (matchIdx !== undefined) {
        matchedOld.add(matchIdx)
        lastOldIdx = matchIdx + 1
      }
    }
  }

  const lcs = matchedOld.size
  return {
    additions: n - lcs,
    deletions: m - lcs,
  }
}

function lcsDiff(oldLines: string[], newLines: string[], m: number, n: number): { additions: number; deletions: number } {
  let prev = new Array<number>(n + 1).fill(0)
  let curr = new Array<number>(n + 1).fill(0)

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1])
      }
    }
    [prev, curr] = [curr, prev]
  }

  const lcs = prev[n]
  return {
    additions: n - lcs,
    deletions: m - lcs,
  }
}

// Tree cache helper
interface TreeEntry {
  path: string
  type: string
  oid: string
}

async function getCachedTree(
  fs: WebFsAdapter,
  treeOid: string,
  cache: Map<string, Map<string, string>>
): Promise<Map<string, string>> {
  const cached = cache.get(treeOid)
  if (cached) return cached

  const files = new Map<string, string>()
  const entries = await git.readTree({ fs, dir: '.', oid: treeOid })

  async function walk(items: TreeEntry[], prefix: string) {
    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.path}` : item.path
      if (item.type === 'blob') {
        files.set(fullPath, item.oid)
      } else if (item.type === 'tree') {
        try {
          const subtree = await git.readTree({ fs, dir: '.', oid: item.oid })
          await walk(subtree.tree as TreeEntry[], fullPath)
        } catch {
          // skip unreadable trees
        }
      }
    }
  }

  await walk(entries.tree as TreeEntry[], '')
  cache.set(treeOid, files)
  return files
}

// Blob cache helper
async function getCachedBlob(
  fs: WebFsAdapter,
  oid: string,
  cache: Map<string, string>
): Promise<string> {
  const cached = cache.get(oid)
  if (cached !== undefined) return cached

  const content = await git.readBlob({ fs, dir: '.', oid })
  const text = new TextDecoder().decode(content.blob)
  cache.set(oid, text)
  return text
}

export async function parseGitRepo(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: ProgressCallback,
  maxCommits = 300,
  resultCommits?: CommitDiff[],
  onPartialCommit?: CommitsCallback
): Promise<CommitDiff[]> {
  const fs = new WebFsAdapter(dirHandle)
  const startTime = Date.now()

  onProgress?.({ phase: 'reading', current: 0, total: 1, message: 'Reading .git directory...', startTime })

  try {
    await fs.promises.stat('.git')
  } catch {
    throw new Error('Not a git repository: .git directory not found')
  }

  onProgress?.({ phase: 'parsing', current: 0, total: maxCommits, message: 'Parsing commit history...', startTime })

  const logs = await git.log({ fs, dir: '.', depth: maxCommits })

  onProgress?.({ phase: 'parsing', current: logs.length, total: logs.length, message: `Found ${logs.length} commits`, startTime })

  onProgress?.({ phase: 'diffing', current: 0, total: logs.length, message: 'Analyzing diffs...', startTime })

  const commits: CommitDiff[] = []
  const blobCache = new Map<string, string>()
  const treeCache = new Map<string, Map<string, string>>()

  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i]
    const commitInfo: CommitInfo = {
      oid: entry.oid || '',
      message: entry.commit?.message || '',
      author: entry.commit?.author?.name || '',
      timestamp: entry.commit?.author?.timestamp || 0,
    }

    const files: FileChange[] = []

    try {
      const treeOid = entry.commit?.tree
      if (!treeOid) continue

      const parentTreeOid = i < logs.length - 1 ? logs[i + 1]?.commit?.tree : undefined

      const currentFiles = await getCachedTree(fs, treeOid, treeCache)
      const parentFiles = parentTreeOid ? await getCachedTree(fs, parentTreeOid, treeCache) : new Map<string, string>()

      // Find added/modified files
      for (const [path, oid] of currentFiles) {
        const parentOid = parentFiles.get(path)
        if (!parentOid) {
          const text = await getCachedBlob(fs, oid, blobCache)
          const lines = text.split('\n').length
          files.push({ path, additions: lines, deletions: 0, oldContent: '', newContent: text })
        } else if (parentOid !== oid) {
          const [currentText, parentText] = await Promise.all([
            getCachedBlob(fs, oid, blobCache),
            getCachedBlob(fs, parentOid, blobCache),
          ])
          const { additions, deletions } = fastDiff(parentText, currentText)
          files.push({ path, additions, deletions, oldContent: parentText, newContent: currentText })
        }
      }

      for (const [path, parentOid] of parentFiles) {
        if (!currentFiles.has(path)) {
          const parentText = await getCachedBlob(fs, parentOid, blobCache)
          const lines = parentText.split('\n').length
          files.push({ path, additions: 0, deletions: lines, oldContent: parentText, newContent: '' })
        }
      }
    } catch {
      // Skip commits with errors
    }

    const commitDiff = { commit: commitInfo, files }
    commits.push(commitDiff)
    if (resultCommits) resultCommits.push(commitDiff)

    if (onPartialCommit && i > 0 && i % 10 === 0) {
      onPartialCommit([...commits])
      await new Promise(r => setTimeout(r, 0))
    }

    // 计算预计剩余时间
    const elapsed = Date.now() - startTime
    const avgTimePerCommit = elapsed / (i + 1)
    const remaining = (logs.length - i - 1) * avgTimePerCommit

    // 获取当前分析的文件列表
    const currentFiles = files.map(f => f.path).slice(0, 3).join(', ')

    onProgress?.({
      phase: 'diffing',
      current: i + 1,
      total: logs.length,
      message: `Analyzing commit ${i + 1}/${logs.length}`,
      currentFile: currentFiles || undefined,
      estimatedTimeRemaining: remaining,
      startTime,
    })
  }

  if (onPartialCommit) onPartialCommit([...commits])

  return commits
}

// Worker 消息处理
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
