/**
 * Diff 路由 — 获取文件内容差异
 */
import { runGit } from '../git-utils.js'

/**
 * 获取指定 commit 中某个文件的内容
 */
async function getFileContent(repoPath, commitHash, filePath) {
  try {
    const content = await runGit(repoPath, ['show', `${commitHash}:${filePath}`])
    return content
  } catch {
    return null
  }
}

/**
 * 处理 diff 详情请求
 * WebSocket 消息类型: request_diff
 */
export async function handleRequestDiff(ws, message) {
  const { repoPath, commitHash, filePath } = message

  try {
    const newContent = await getFileContent(repoPath, commitHash, filePath)

    let oldContent = ''
    try {
      const parentHash = `${commitHash}~1`
      oldContent = await getFileContent(repoPath, parentHash, filePath) || ''
    } catch {
      oldContent = ''
    }

    ws.send(JSON.stringify({
      type: 'diff_detail',
      commitHash,
      filePath,
      oldContent,
      newContent,
      additions: 0,
      deletions: 0,
    }))
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Failed to get diff: ${error.message}`,
      code: 'DIFF_FAILED'
    }))
  }
}