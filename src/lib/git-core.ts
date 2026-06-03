// isomorphic-git 类型参考，实际使用自定义 FS 适配器
import type { CommitDiff, CommitInfo, FileChange, ParseProgress } from './types'

type ProgressCallback = (progress: ParseProgress) => void
type CommitsCallback = (commits: CommitDiff[]) => void

export class FakeStats {
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

export class WebFsAdapter {
  private rootDir: FileSystemDirectoryHandle
  private dirCache = new Map<string, FileSystemDirectoryHandle>()
  promises: {
    readFile: (filepath: string, options?: { encoding?: string }) => Promise<Uint8Array | string>
    writeFile: (filepath: string, data: Uint8Array | string) => Promise<void>
    mkdir: (dirpath: string) => Promise<void>
    rmdir: (dirpath: string) => Promise<void>
    readdir: (dirpath: string) => Promise<string[]>
    stat: (filepath: string) => Promise<FakeStats>
    lstat: (filepath: string) => Promise<FakeStats>
    readlink: () => Promise<string>
    symlink: () => Promise<void>
    chmod: () => Promise<void>
    unlink: (filepath: string) => Promise<void>
  }

  constructor(rootDir: FileSystemDirectoryHandle) {
    this.rootDir = rootDir
    this.dirCache.set('/', rootDir)
    this.dirCache.set('.', rootDir)
    this.promises = {
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
}

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

// 手动解析 git 对象（zlib 解压）
async function readGitObject(fs: WebFsAdapter, oid: string): Promise<{ type: string; content: Uint8Array }> {
  const path = `.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`
  const data = await fs.promises.readFile(path) as Uint8Array

  // 使用 DecompressionStream 解压 zlib
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    }
  })

  const decompressed = stream.pipeThrough(new DecompressionStream('deflate'))
  const reader = decompressed.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  // 合并 chunks
  let totalLength = 0
  for (const chunk of chunks) totalLength += chunk.length
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  // 解析 header: "type size\0content"
  const nullIndex = result.indexOf(0)
  const header = new TextDecoder().decode(result.slice(0, nullIndex))
  const [type] = header.split(' ')
  const content = result.slice(nullIndex + 1)

  return { type, content }
}

// 手动解析 commit 对象
function parseCommit(content: Uint8Array): { tree: string; parent: string[]; author: { name: string; email: string; timestamp: number; timezoneOffset: number }; committer: { name: string; email: string; timestamp: number; timezoneOffset: number }; message: string } {
  const text = new TextDecoder().decode(content)
  const lines = text.split('\n')

  let tree = ''
  const parents: string[] = []
  let author: { name: string; email: string; timestamp: number; timezoneOffset: number } | null = null
  let committer: { name: string; email: string; timestamp: number; timezoneOffset: number } | null = null
  let messageStart = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      messageStart = i + 1
      break
    }
    if (line.startsWith('tree ')) {
      tree = line.slice(5)
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      author = parsePerson(line.slice(7))
    } else if (line.startsWith('committer ')) {
      committer = parsePerson(line.slice(10))
    }
  }

  const message = lines.slice(messageStart).join('\n')

  return {
    tree,
    parent: parents,
    author: author || { name: '', email: '', timestamp: 0, timezoneOffset: 0 },
    committer: committer || { name: '', email: '', timestamp: 0, timezoneOffset: 0 },
    message
  }
}

function parsePerson(line: string): { name: string; email: string; timestamp: number; timezoneOffset: number } {
  // Format: "Name <email> timestamp timezone"
  const emailMatch = line.match(/<([^>]+)>/)
  const email = emailMatch ? emailMatch[1] : ''
  const name = line.slice(0, line.indexOf('<')).trim()

  const parts = line.split(' ')
  const timestamp = parseInt(parts[parts.length - 2] || '0', 10)
  const timezoneOffset = parseInt(parts[parts.length - 1] || '0', 10)

  return { name, email, timestamp, timezoneOffset }
}

interface TreeEntry {
  path: string
  type: string
  oid: string
}

async function getCachedTree(
  fs: WebFsAdapter,
  treeOid: string,
  cache: Map<string, Map<string, string>>,
  logPrefix: string
): Promise<Map<string, string>> {
  const cached = cache.get(treeOid)
  if (cached) return cached

  const files = new Map<string, string>()

  try {
    const { content } = await readGitObject(fs, treeOid)
    const entries = parseTree(content)

    async function walk(items: TreeEntry[], prefix: string) {
      for (const item of items) {
        const fullPath = prefix ? `${prefix}/${item.path}` : item.path
        if (item.type === 'blob') {
          files.set(fullPath, item.oid)
        } else if (item.type === 'tree') {
          try {
            const { content } = await readGitObject(fs, item.oid)
            const subtree = parseTree(content)
            await walk(subtree, fullPath)
          } catch {
            // skip unreadable trees
          }
        }
      }
    }

    await walk(entries, '')
  } catch (err) {
    console.error(`[${logPrefix}] Failed to read tree:`, treeOid, (err as Error).message)
  }

  cache.set(treeOid, files)
  return files
}

function parseTree(content: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = []
  let offset = 0

  while (offset < content.length) {
    // Find space (mode ends with space)
    const spaceIndex = content.indexOf(0x20, offset)
    if (spaceIndex === -1) break

    const mode = new TextDecoder().decode(content.slice(offset, spaceIndex))
    offset = spaceIndex + 1

    // Find null (path ends with null)
    const nullIndex = content.indexOf(0, offset)
    if (nullIndex === -1) break

    const path = new TextDecoder().decode(content.slice(offset, nullIndex))
    offset = nullIndex + 1

    // Read 20 bytes for oid
    const oidBytes = content.slice(offset, offset + 20)
    const oid = Array.from(oidBytes).map(b => b.toString(16).padStart(2, '0')).join('')
    offset += 20

    const type = mode === '40000' ? 'tree' : 'blob'
    entries.push({ path, type, oid })
  }

  return entries
}

async function getCachedBlob(
  fs: WebFsAdapter,
  oid: string,
  cache: Map<string, string>,
  logPrefix: string
): Promise<string> {
  const cached = cache.get(oid)
  if (cached !== undefined) return cached

  try {
    const { content } = await readGitObject(fs, oid)
    const text = new TextDecoder().decode(content)
    cache.set(oid, text)
    return text
  } catch (err) {
    console.error(`[${logPrefix}] Failed to read blob:`, oid, (err as Error).message)
    cache.set(oid, '')
    return ''
  }
}

async function resolveHeadOid(fs: WebFsAdapter): Promise<string> {
  const headContent = await fs.promises.readFile('.git/HEAD', { encoding: 'utf8' }) as string
  const trimmed = headContent.trim()

  if (trimmed.startsWith('ref: ')) {
    const refPath = trimmed.slice(5)
    try {
      const refContent = await fs.promises.readFile(`.git/${refPath}`, { encoding: 'utf8' }) as string
      return refContent.trim()
    } catch {
      try {
        const packedRefs = await fs.promises.readFile('.git/packed-refs', { encoding: 'utf8' }) as string
        for (const line of packedRefs.split('\n')) {
          const parts = line.trim().split(' ')
          if (parts.length === 2 && parts[1] === refPath) {
            return parts[0]
          }
        }
      } catch {
        // no packed-refs
      }
      throw new Error(`无法解析 Git 引用: ${refPath}`)
    }
  }

  if (/^[0-9a-f]{40}$/.test(trimmed)) {
    return trimmed
  }

  throw new Error(`无法解析 .git/HEAD: ${trimmed}`)
}

async function walkCommitChain(
  fs: WebFsAdapter,
  headOid: string,
  maxCommits: number,
  logPrefix: string,
  onProgress?: (count: number) => void
): Promise<Array<{ oid: string; commit: ReturnType<typeof parseCommit> }>> {
  const logs: Array<{ oid: string; commit: ReturnType<typeof parseCommit> }> = []
  let currentOid: string | undefined = headOid
  const seen = new Set<string>()

  while (currentOid && logs.length < maxCommits && !seen.has(currentOid)) {
    seen.add(currentOid)
    try {
      const { type, content } = await readGitObject(fs, currentOid)
      if (type !== 'commit') {
        console.error(`[${logPrefix}] Object ${currentOid} is not a commit, type: ${type}`)
        break
      }
      const commit = parseCommit(content)
      logs.push({ oid: currentOid, commit })
      onProgress?.(logs.length)

      if (commit.parent.length > 0) {
        currentOid = commit.parent[0]
      } else {
        break
      }
    } catch (err) {
      console.error(`[${logPrefix}] readCommit failed for ${currentOid}:`, (err as Error).message)
      break
    }
  }

  return logs
}

export interface ParseGitRepoOptions {
  dirHandle: FileSystemDirectoryHandle
  onProgress?: ProgressCallback
  maxCommits?: number
  resultCommits?: CommitDiff[]
  onPartialCommit?: CommitsCallback
  logPrefix?: string
  includeStartTime?: boolean
  checkEmptyCommits?: boolean
}

export async function parseGitRepo(options: ParseGitRepoOptions): Promise<CommitDiff[]> {
  const {
    dirHandle,
    onProgress,
    maxCommits = 300,
    resultCommits,
    onPartialCommit,
    logPrefix = 'git-core',
    includeStartTime = true,
    checkEmptyCommits = false
  } = options

  const fs = new WebFsAdapter(dirHandle)
  const startTime = includeStartTime ? Date.now() : undefined

  const createProgress = (phase: ParseProgress['phase'], current: number, total: number, message: string, extra?: Partial<ParseProgress>): ParseProgress => ({
    phase,
    current,
    total,
    message,
    ...(includeStartTime && startTime !== undefined ? { startTime } : {}),
    ...extra
  })

  onProgress?.(createProgress('reading', 0, 1, 'Reading .git directory...'))

  try {
    await fs.promises.stat('.git')
  } catch {
    throw new Error('Not a git repository: .git directory not found')
  }

  onProgress?.(createProgress('parsing', 0, maxCommits, 'Resolving HEAD...'))

  let headOid: string
  try {
    headOid = await resolveHeadOid(fs)
    console.log(`[${logPrefix}] resolveHeadOid success:`, headOid)
  } catch (headErr) {
    console.warn(`[${logPrefix}] resolveHeadOid failed:`, (headErr as Error).message)
    throw new Error(`无法解析 Git HEAD: ${(headErr as Error).message}`, { cause: headErr })
  }

  onProgress?.(createProgress('parsing', 0, maxCommits, 'Walking commit chain...'))

  const logs = await walkCommitChain(fs, headOid, maxCommits, logPrefix, (count) => {
    onProgress?.(createProgress('parsing', count, Math.max(count, maxCommits), `Reading commit ${count}...`))
  })

  console.log(`[${logPrefix}] walkCommitChain result:`, logs.length, 'commits')

  if (checkEmptyCommits && logs.length === 0) {
    throw new Error('未找到任何提交记录，请确认仓库不为空')
  }

  onProgress?.(createProgress('parsing', logs.length, logs.length, `Found ${logs.length} commits`))

  onProgress?.(createProgress('diffing', 0, logs.length, 'Analyzing diffs...'))

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

      const currentFiles = await getCachedTree(fs, treeOid, treeCache, logPrefix)
      const parentFiles = parentTreeOid ? await getCachedTree(fs, parentTreeOid, treeCache, logPrefix) : new Map<string, string>()

      for (const [path, oid] of currentFiles) {
        const parentOid = parentFiles.get(path)
        if (!parentOid) {
          const text = await getCachedBlob(fs, oid, blobCache, logPrefix)
          const lines = text.split('\n').length
          files.push({ path, additions: lines, deletions: 0, oldContent: '', newContent: text })
        } else if (parentOid !== oid) {
          const [currentText, parentText] = await Promise.all([
            getCachedBlob(fs, oid, blobCache, logPrefix),
            getCachedBlob(fs, parentOid, blobCache, logPrefix),
          ])
          const { additions, deletions } = fastDiff(parentText, currentText)
          files.push({ path, additions, deletions, oldContent: parentText, newContent: currentText })
        }
      }

      for (const [path, parentOid] of parentFiles) {
        if (!currentFiles.has(path)) {
          const parentText = await getCachedBlob(fs, parentOid, blobCache, logPrefix)
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

    const currentFiles = files.map(f => f.path).slice(0, 3).join(', ')

    const extra: Partial<ParseProgress> = {}
    if (includeStartTime && startTime !== undefined) {
      const elapsed = Date.now() - startTime
      const avgTimePerCommit = elapsed / (i + 1)
      const remaining = (logs.length - i - 1) * avgTimePerCommit
      extra.estimatedTimeRemaining = remaining
    }

    onProgress?.(createProgress('diffing', i + 1, logs.length, `Analyzing commit ${i + 1}/${logs.length}`, {
      currentFile: currentFiles || undefined,
      ...extra
    }))
  }

  if (onPartialCommit) onPartialCommit([...commits])

  return commits
}
