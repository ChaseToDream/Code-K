import * as git from 'isomorphic-git';
import type { CommitDiff, CommitInfo, FileChange, ParseProgress } from './types';

type ProgressCallback = (progress: ParseProgress) => void;

// Minimal fs.Stats-compatible wrapper that isomorphic-git expects
class FakeStats {
  size: number;
  mode: number;
  mtimeMs: number;
  private _isDir: boolean;

  constructor(size: number, mode: number, mtimeMs: number, isDir: boolean) {
    this.size = size;
    this.mode = mode;
    this.mtimeMs = mtimeMs;
    this._isDir = isDir;
  }

  isDirectory(): boolean { return this._isDir; }
  isFile(): boolean { return !this._isDir; }
  isSymbolicLink(): boolean { return false; }
}

// Custom FS adapter using File System Access API
// The `promises` property + top-level promise methods ensure isomorphic-git's
// isPromiseFs() test passes, so methods are bound directly (not via pify).
class WebFsAdapter {
  private rootDir: FileSystemDirectoryHandle;
  private dirCache = new Map<string, FileSystemDirectoryHandle>();

  constructor(rootDir: FileSystemDirectoryHandle) {
    this.rootDir = rootDir;
    this.dirCache.set('/', rootDir);
    this.dirCache.set('.', rootDir);
  }

  private splitPath(filepath: string): string[] {
    return filepath.split('/').filter(Boolean);
  }

  private async getDirHandle(dirPath: string): Promise<FileSystemDirectoryHandle> {
    const normalized = '/' + dirPath.split('/').filter(Boolean).join('/');
    if (this.dirCache.has(normalized)) return this.dirCache.get(normalized)!;

    const parts = this.splitPath(dirPath);
    let current = this.rootDir;
    let built = '';
    for (const part of parts) {
      built += '/' + part;
      if (this.dirCache.has(built)) {
        current = this.dirCache.get(built)!;
      } else {
        current = await current.getDirectoryHandle(part, { create: false });
        this.dirCache.set(built, current);
      }
    }
    this.dirCache.set(normalized, current);
    return current;
  }

  private async getParentAndName(filepath: string): Promise<[FileSystemDirectoryHandle, string]> {
    const parts = this.splitPath(filepath);
    const name = parts.pop()!;
    const parentPath = parts.join('/');
    const parent = await this.getDirHandle(parentPath || '/');
    return [parent, name];
  }

  // Top-level promise methods (required for isomorphic-git's isPromiseFs detection)
  async readFile(filepath: string, options?: { encoding?: string }): Promise<Uint8Array | string> {
    const [dir, name] = await this.getParentAndName(filepath);
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    if (options?.encoding === 'utf8') return await file.text();
    return new Uint8Array(await file.arrayBuffer());
  }

  async writeFile(filepath: string, data: Uint8Array | string): Promise<void> {
    const [dir, name] = await this.getParentAndName(filepath);
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(data);
    await writable.close();
  }

  async mkdir(dirpath: string): Promise<void> {
    const parts = this.splitPath(dirpath);
    let current = this.rootDir;
    let built = '';
    for (const part of parts) {
      built += '/' + part;
      current = await current.getDirectoryHandle(part, { create: true });
      this.dirCache.set(built, current);
    }
  }

  async rmdir(dirpath: string): Promise<void> {
    const [dir, name] = await this.getParentAndName(dirpath);
    await (dir as any).removeEntry(name, { recursive: true });
  }

  async readdir(dirpath: string): Promise<string[]> {
    const dir = await this.getDirHandle(dirpath);
    const entries: string[] = [];
    for await (const entry of (dir as any).entries()) entries.push(entry[0]);
    return entries;
  }

  async stat(filepath: string): Promise<FakeStats> {
    try {
      const [dir, name] = await this.getParentAndName(filepath);
      const fileHandle = await dir.getFileHandle(name);
      const file = await fileHandle.getFile();
      return new FakeStats(file.size, 0o100644, file.lastModified, false);
    } catch {
      await this.getDirHandle(filepath);
      return new FakeStats(0, 0o40000, 0, true);
    }
  }

  async lstat(filepath: string): Promise<FakeStats> {
    return this.stat(filepath);
  }

  async readlink(): Promise<string> {
    throw new Error('readlink not supported');
  }

  async symlink(): Promise<void> {
    throw new Error('symlink not supported');
  }

  async chmod(): Promise<void> {}

  async unlink(filepath: string): Promise<void> {
    const [dir, name] = await this.getParentAndName(filepath);
    await (dir as any).removeEntry(name);
  }

  // Also expose via `promises` property (isomorphic-git prefers this)
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
    };
  }
}

type CommitsCallback = (commits: CommitDiff[]) => void;

export async function parseGitRepo(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: ProgressCallback,
  maxCommits = 500,
  resultCommits?: CommitDiff[],
  onPartialCommit?: CommitsCallback
): Promise<CommitDiff[]> {
  const fs = new WebFsAdapter(dirHandle);

  onProgress?.({ phase: 'reading', current: 0, total: 1, message: 'Reading .git directory...' });

  // Verify .git exists
  try {
    await fs.promises.stat('.git');
  } catch {
    throw new Error('Not a git repository: .git directory not found');
  }

  // Get commit log
  onProgress?.({ phase: 'parsing', current: 0, total: maxCommits, message: 'Parsing commit history...' });

  const logs = await git.log({ fs, dir: '.', depth: maxCommits });

  onProgress?.({ phase: 'parsing', current: logs.length, total: logs.length, message: `Found ${logs.length} commits` });

  // Build diffs for each commit pair
  onProgress?.({ phase: 'diffing', current: 0, total: logs.length, message: 'Analyzing diffs...' });

  const commits: CommitDiff[] = [];

  // Blob cache: oid -> text content (avoids re-reading same blobs across commits)
  const blobCache = new Map<string, string>();

  // Tree cache: treeOid -> Map<path, oid>
  const treeCache = new Map<string, Map<string, string>>();

  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i];
    const commitInfo: CommitInfo = {
      oid: entry.oid,
      message: entry.commit.message,
      author: entry.commit.author.name,
      timestamp: entry.commit.author.timestamp,
    };

    const files: FileChange[] = [];

    try {
      const treeOid = entry.commit.tree;
      const parentTreeOid = i < logs.length - 1 ? logs[i + 1].commit.tree : undefined;

      // Read trees from cache
      const currentFiles = await getCachedTree(fs, treeOid, treeCache);
      const parentFiles = parentTreeOid ? await getCachedTree(fs, parentTreeOid, treeCache) : new Map<string, string>();

      // Find added/modified files
      for (const [path, oid] of currentFiles) {
        const parentOid = parentFiles.get(path);
        if (!parentOid) {
          // New file (IPO)
          const text = await getCachedBlob(fs, oid, blobCache);
          const lines = text.split('\n').length;
          files.push({ path, additions: lines, deletions: 0 });
        } else if (parentOid !== oid) {
          // Modified file
          const [currentText, parentText] = await Promise.all([
            getCachedBlob(fs, oid, blobCache),
            getCachedBlob(fs, parentOid, blobCache),
          ]);
          const { additions, deletions } = fastDiff(parentText, currentText);
          files.push({ path, additions, deletions });
        }
      }

      // Find deleted files
      for (const [path, parentOid] of parentFiles) {
        if (!currentFiles.has(path)) {
          const parentText = await getCachedBlob(fs, parentOid, blobCache);
          const lines = parentText.split('\n').length;
          files.push({ path, additions: 0, deletions: lines });
        }
      }
    } catch {
      // Skip commits with errors (binary files, etc.)
    }

    const commitDiff = { commit: commitInfo, files };
    commits.push(commitDiff);
    if (resultCommits) resultCommits.push(commitDiff);

    // Yield to main thread and report partial results every 5 commits
    if (onPartialCommit && i > 0 && i % 5 === 0) {
      onPartialCommit([...commits])
      await new Promise(r => setTimeout(r, 0))
    }

    onProgress?.({
      phase: 'diffing',
      current: i + 1,
      total: logs.length,
      message: `Analyzing commit ${i + 1}/${logs.length}`,
    });
  }

  // Final partial commit call
  if (onPartialCommit) onPartialCommit([...commits])

  return commits;
}

async function getCachedTree(
  fs: WebFsAdapter,
  treeOid: string,
  cache: Map<string, Map<string, string>>
): Promise<Map<string, string>> {
  const cached = cache.get(treeOid);
  if (cached) return cached;

  const files = new Map<string, string>();
  const entries = await git.readTree({ fs, dir: '.', oid: treeOid });

  async function walk(items: any[], prefix: string) {
    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.path}` : item.path;
      if (item.type === 'blob') {
        files.set(fullPath, item.oid);
      } else if (item.type === 'tree') {
        try {
          const subtree = await git.readTree({ fs, dir: '.', oid: item.oid });
          await walk(subtree.tree, fullPath);
        } catch {
          // skip unreadable trees
        }
      }
    }
  }

  await walk(entries.tree, '');
  cache.set(treeOid, files);
  return files;
}

async function getCachedBlob(
  fs: WebFsAdapter,
  oid: string,
  cache: Map<string, string>
): Promise<string> {
  const cached = cache.get(oid);
  if (cached !== undefined) return cached;

  const content = await git.readBlob({ fs, dir: '.', oid });
  const text = new TextDecoder().decode(content.blob);
  cache.set(oid, text);
  return text;
}

/**
 * Fast line diff using sampling-based approach instead of O(m*n) LCS DP.
 * Much faster for large files while still producing reasonable diff counts.
 */
function fastDiff(oldText: string, newText: string): { additions: number; deletions: number } {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // Quick check for identical files
  if (m === n && oldLines.every((line, i) => line === newLines[i])) {
    return { additions: 0, deletions: 0 };
  }

  // For small files (< 200 lines each), use precise LCS
  if (m * n <= 40_000) {
    return lcsDiff(oldLines, newLines, m, n);
  }

  // Build a hash map of old lines for quick lookup
  const oldLineIndices = new Map<string, number[]>();
  for (let i = 0; i < m; i++) {
    const indices = oldLineIndices.get(oldLines[i]);
    if (indices) indices.push(i);
    else oldLineIndices.set(oldLines[i], [i]);
  }

  // Track which old lines are "matched" to new lines (greedy LCS)
  const matchedOld = new Set<number>();
  let lastOldIdx = 0;

  for (let j = 0; j < n; j++) {
    const indices = oldLineIndices.get(newLines[j]);
    if (indices) {
      // Find first index >= lastOldIdx
      const matchIdx = indices.find(i => i >= lastOldIdx);
      if (matchIdx !== undefined) {
        matchedOld.add(matchIdx);
        lastOldIdx = matchIdx + 1;
      }
    }
  }

  const lcs = matchedOld.size;
  return {
    additions: n - lcs,
    deletions: m - lcs,
  };
}

/**
 * Precise LCS-based diff for small files. Uses space-optimized DP (two rows).
 */
function lcsDiff(oldLines: string[], newLines: string[], m: number, n: number): { additions: number; deletions: number } {
  // Space-optimized LCS using two rows
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    // Swap rows
    [prev, curr] = [curr, prev];
  }

  const lcs = prev[n];
  return {
    additions: n - lcs,
    deletions: m - lcs,
  };
}
