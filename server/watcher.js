import { runGit } from './git-utils.js'

// 轮询间隔（毫秒）
const POLL_INTERVAL = 5000

// 活跃的监视任务: repoId -> { repoPath, repoName, lastHead, intervalId, clients: Set<ws> }
const activeWatchers = new Map()

/**
 * 获取当前 HEAD commit hash
 */
async function getHeadCommit(repoPath) {
  try {
    const output = await runGit(repoPath, ['rev-parse', 'HEAD'])
    return output.trim()
  } catch {
    return null
  }
}

/**
 * 获取指定 commit 的详细信息及文件差异
 * 使用 --numstat --reverse 一次性获取变更统计，避免 diff-tree 的 parent 假设错误
 */
async function getCommitWithDiff(repoPath, hash) {
  const parentHash = `${hash}~1`
  let parentExists = true
  try {
    await runGit(repoPath, ['cat-file', '-t', parentHash])
  } catch {
    parentExists = false
  }

  const logOutput = await runGit(repoPath, [
    'log', '-1',
    '--numstat', '--reverse',
    '--format=%H%x00%an%x00%at%x00%s',
    hash
  ])

  let currentCommit = null
  let files = []

  for (const line of logOutput.split('\n')) {
    if (!line.trim()) continue
    if (line.includes('\0')) {
      const [commitHash, author, timestamp, message] = line.split('\0')
      currentCommit = {
        oid: commitHash,
        message,
        author,
        timestamp: parseInt(timestamp)
      }
    } else {
      const parts = line.split('\t')
      if (parts.length < 3) continue
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0])
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1])
      const path = parts[2]
      if (parts[0] === '-' && parts[1] === '-') continue
      files.push({ path, additions, deletions })
    }
  }

  // 兜底：如果上面没有获取到 files，尝试用 diff-tree
  if (files.length === 0) {
    let numstat
    if (!parentExists) {
      numstat = await runGit(repoPath, ['diff-tree', '--numstat', '--root', '-r', hash])
    } else {
      numstat = await runGit(repoPath, ['diff-tree', '--numstat', '-r', parentHash, hash])
    }
    files = parseNumstat(numstat)
  }

  return {
    commit: currentCommit,
    files
  }
}

/**
 * 解析 numstat 输出
 */
function parseNumstat(output) {
  const files = []
  for (const line of output.split('\n').filter(Boolean)) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const additions = parts[0] === '-' ? 0 : parseInt(parts[0])
    const deletions = parts[1] === '-' ? 0 : parseInt(parts[1])
    const path = parts[2]
    if (parts[0] === '-' && parts[1] === '-') continue
    files.push({ path, additions, deletions })
  }
  return files
}

/**
 * 获取两个 commit 之间的新增 commits
 * 使用 --first-parent 保持与初始解析一致，避免 merge commit 引入额外 commits
 */
async function getNewCommits(repoPath, lastKnownHead) {
  try {
    const logOutput = await runGit(repoPath, [
      'log', `${lastKnownHead}..HEAD`, '--reverse',
      '--first-parent',
      '--format=%H%x00%an%x00%at%x00%s'
    ])

    if (!logOutput.trim()) return []

    const commits = []
    for (const line of logOutput.split('\n').filter(Boolean)) {
      const [hash, author, timestamp, message] = line.split('\0')
      commits.push({ hash, author, timestamp: parseInt(timestamp), message })
    }
    return commits
  } catch {
    return []
  }
}

/**
 * 开始监视仓库
 */
export async function startWatching(repoId, repoPath, repoName, ws) {
  let watcher = activeWatchers.get(repoId)

  if (watcher) {
    // 已有监视任务，只需添加客户端
    watcher.clients.add(ws)
    console.log(`[Watcher] Client added to existing watcher for ${repoName}`)
    return
  }

  // 获取当前 HEAD
  const head = await getHeadCommit(repoPath)
  if (!head) {
    console.error(`[Watcher] Failed to get HEAD for ${repoName}`)
    return
  }

  // 创建新的监视任务
  watcher = {
    repoPath,
    repoName,
    lastHead: head,
    clients: new Set([ws]),
    intervalId: null
  }

  // 启动轮询
  watcher.intervalId = setInterval(async () => {
    await checkForUpdates(repoId)
  }, POLL_INTERVAL)

  activeWatchers.set(repoId, watcher)
  console.log(`[Watcher] Started watching ${repoName} (HEAD: ${head.slice(0, 8)})`)
}

/**
 * 停止客户端的监视
 */
export function stopWatching(ws) {
  for (const [repoId, watcher] of activeWatchers) {
    if (watcher.clients.has(ws)) {
      watcher.clients.delete(ws)
      console.log(`[Watcher] Client removed from ${watcher.repoName}`)

      // 如果没有客户端了，停止轮询
      if (watcher.clients.size === 0) {
        clearInterval(watcher.intervalId)
        activeWatchers.delete(repoId)
        console.log(`[Watcher] Stopped watching ${watcher.repoName} (no clients)`)
      }
    }
  }
}

/**
 * 检查更新并推送
 */
async function checkForUpdates(repoId) {
  const watcher = activeWatchers.get(repoId)
  if (!watcher) return

  const { repoPath, repoName, lastHead } = watcher

  try {
    const currentHead = await getHeadCommit(repoPath)
    if (!currentHead || currentHead === lastHead) {
      return // 没有变化
    }

    console.log(`[Watcher] New commits detected in ${repoName}: ${lastHead.slice(0, 8)} -> ${currentHead.slice(0, 8)}`)

    // 获取新增的 commits（使用 --first-parent 保持与初始解析一致）
    const newCommits = await getNewCommits(repoPath, lastHead)
    if (newCommits.length === 0) {
      // 可能是 reset 或其他操作，直接更新 HEAD
      watcher.lastHead = currentHead
      return
    }

    // 获取每个新 commit 的 diff（复用 getCommitWithDiff，内部已处理 --numstat）
    const commitDiffs = []
    for (const commit of newCommits) {
      const diff = await getCommitWithDiff(repoPath, commit.hash)
      if (diff.commit) {
        commitDiffs.push(diff)
      }
    }

    // 更新 lastHead
    watcher.lastHead = currentHead

    // 推送给所有客户端
    const message = JSON.stringify({
      type: 'commits_update',
      repoId,
      repoName,
      commits: commitDiffs,
      newHead: currentHead
    })

    for (const client of watcher.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message)
      }
    }

    console.log(`[Watcher] Pushed ${commitDiffs.length} new commits to ${watcher.clients.size} client(s)`)

  } catch (error) {
    console.error(`[Watcher] Error checking updates for ${repoName}:`, error.message)
  }
}

/**
 * 清理所有监视任务
 */
export function cleanupAllWatchers() {
  for (const [repoId, watcher] of activeWatchers) {
    clearInterval(watcher.intervalId)
    console.log(`[Watcher] Cleaned up watcher for ${watcher.repoName}`)
  }
  activeWatchers.clear()
}
