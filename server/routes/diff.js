/**
 * Diff 路由 — 通过 WebSocket 获取文件内容差异
 *
 * 消息契约：
 *   请求: { type:'request_diff', repoPath, commitHash, filePath }
 *   响应: { type:'diff_detail', repoPath, commitHash, filePath,
 *           oldContent: string|null, newContent: string|null,
 *           additions: number, deletions: number,
 *           isBinary?: boolean, error?: string }
 *
 * commitHash 支持 8 位短 hash（git show <short>:<path> 可用）。
 * 内容字段为 null 表示"不存在"：文件新增时 oldContent 为 null，删除时 newContent 为 null。
 * 二进制文件无行数与内容可展示：isBinary=true，内容与增删行数均为 null/0。
 * 任何 git 失败都不抛出，统一回带 error 字段的 diff_detail，避免击穿 WebSocket 连接。
 */
import { runGit } from '../git-utils.js'
import { parseNumstatLine } from '../lib/numstat-parser.js'
import { validateRepoPathForWS } from '../ws-handler.js'

/**
 * 获取指定 commit 中某个文件的内容
 * @returns {Promise<string|null>} 文件内容；该 revision 下文件不存在时返回 null
 */
async function getFileContent(repoPath, ref, filePath) {
  try {
    return await runGit(repoPath, ['show', `${ref}:${filePath}`])
  } catch {
    return null
  }
}

/**
 * 获取该 commit 中指定文件的增删行数
 * @returns {Promise<{additions: number, deletions: number, isBinary: boolean, renamedFrom?: string}>}
 */
async function getNumstat(repoPath, commitHash, filePath) {
  const output = await runGit(repoPath, [
    'show', '--numstat', '--format=', commitHash, '--', filePath,
  ])
  for (const line of output.split('\n')) {
    const parsed = parseNumstatLine(line)
    if (parsed) return parsed
  }
  return { additions: 0, deletions: 0, isBinary: false }
}

/**
 * 处理 diff 详情请求
 * WebSocket 消息类型: request_diff
 */
export async function handleRequestDiff(ws, message) {
  const { repoPath: rawRepoPath, commitHash, filePath } = message

  const reply = (fields) => {
    ws.send(JSON.stringify({
      type: 'diff_detail',
      repoPath: rawRepoPath,
      commitHash,
      filePath,
      oldContent: null,
      newContent: null,
      additions: 0,
      deletions: 0,
      ...fields,
    }))
  }

  try {
    const repoPath = validateRepoPathForWS(rawRepoPath)
    if (!repoPath) {
      return reply({ error: '不是有效的Git仓库或路径不合法' })
    }
    if (!commitHash || typeof commitHash !== 'string' || !/^[0-9a-f]{4,40}$/i.test(commitHash)) {
      return reply({ error: '无效的 commitHash' })
    }
    if (!filePath || typeof filePath !== 'string' || filePath.includes('\0')) {
      return reply({ error: '无效的 filePath' })
    }

    // 增删行数 + 二进制判定。numstat 失败说明 commitHash 无效等硬错误，直接回 error
    let stat
    try {
      stat = await getNumstat(repoPath, commitHash, filePath)
    } catch (err) {
      return reply({ error: `Failed to get diff: ${err.message}` })
    }

    if (stat.isBinary) {
      return reply({ isBinary: true })
    }

    // 新内容：本 commit 下的文件内容（文件被删除时不存在 -> null）
    const newContent = await getFileContent(repoPath, commitHash, filePath)
    // 父内容：父 commit 下的文件内容（文件新增或根 commit 时不存在 -> null）
    // 重命名场景下父内容位于旧路径
    const oldContent = await getFileContent(repoPath, `${commitHash}^`, stat.renamedFrom || filePath)

    reply({
      oldContent,
      newContent,
      additions: stat.additions,
      deletions: stat.deletions,
    })
  } catch (error) {
    // 兜底：任何未预期的失败都不得击穿连接
    reply({ error: `Failed to get diff: ${error.message}` })
  }
}
