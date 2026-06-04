/**
 * WebSocket 处理器 — 消息路由与解析任务编排
 */
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { startWatching, stopWatching } from './watcher.js'
import { getCommitsWithDiff, buildFileStocks } from './services/parser.js'
import { generateRepoId } from './lib/kline-core.js'
import { handleRequestDiff } from './routes/diff.js'
import { loadCache, saveCache, getHeadCommit } from './services/cache.js'

/**
 * 校验 repoPath 合法性（WebSocket 层）：绝对路径、无遍历、真实目录
 * @param {string} repoPath
 * @returns {string|null} 校验通过返回规范化路径，否则返回 null
 */
function validateRepoPathForWS(repoPath) {
  if (!repoPath || typeof repoPath !== 'string') return null

  // 禁止 null 字节
  if (repoPath.includes('\0')) return null

  const normalized = resolve(repoPath)

  // 必须是绝对路径（Windows / Unix）
  if (!normalized.startsWith(sep) && !/^[A-Za-z]:[\\\/]/.test(normalized)) {
    return null
  }

  // 校验是否为真实目录
  try {
    if (!existsSync(join(normalized, '.git'))) return null
  } catch {
    return null
  }

  return normalized
}

// 活跃的解析任务
const activeParses = new Map()

/**
 * 设置 WebSocket 服务器
 */
export function setupWebSocket(wss) {
  wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected')

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString())
        console.log('[WebSocket] Received:', message.type)

        switch (message.type) {
          case 'start_parse':
            await handleStartParse(ws, message)
            break
          case 'stop_parse':
            handleStopParse(ws)
            break
          case 'request_diff':
            await handleRequestDiff(ws, message)
            break
          default:
            ws.send(JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${message.type}`,
              code: 'UNKNOWN_TYPE'
            }))
        }
      } catch (error) {
        console.error('[WebSocket] Error processing message:', error)
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message,
          code: 'PROCESSING_ERROR'
        }))
      }
    })

    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected')
      cleanupParses(ws)
      stopWatching(ws)
    })

    ws.on('error', (error) => {
      console.error('[WebSocket] Connection error:', error)
      cleanupParses(ws)
      stopWatching(ws)
    })
  })
}

/**
 * 开始解析仓库 — 优先使用缓存
 */
async function handleStartParse(ws, message) {
  const { repoPath: rawRepoPath, repoName, maxCommits = 300 } = message

  const repoPath = validateRepoPathForWS(rawRepoPath)
  if (!repoPath) {
    ws.send(JSON.stringify({
      type: 'error',
      message: '不是有效的Git仓库或路径不合法',
      code: 'INVALID_REPO'
    }))
    return
  }

  const repoId = generateRepoId(repoPath)
  stopExistingParse(ws)

  ws.send(JSON.stringify({
    type: 'parse_started',
    repoId,
    repoName
  }))

  // 检查磁盘缓存
  const cached = loadCache(repoId)
  if (cached && cached.stocks && cached.stocks.length > 0) {
    const currentHead = await getHeadCommit(repoPath)
    if (currentHead && cached.lastHead === currentHead) {
      // 缓存命中：HEAD 未变，直接返回
      console.log(`[Cache] Hit for ${repoName}: ${cached.stocks.length} stocks, ${cached.commitCount} commits`)
      ws.send(JSON.stringify({
        type: 'complete',
        repoId,
        repoName,
        stocks: cached.stocks,
        totalCommits: cached.commitCount,
        totalTime: 0,
        fromCache: true,
      }))
      // 启动监视
      startWatching(repoId, repoPath, repoName, ws)
      return
    }
    // HEAD 变了，缓存失效，删除
    console.log(`[Cache] Stale for ${repoName}, will re-parse`)
  }

  // 缓存未命中，开始解析
  const abortController = new AbortController()
  const parseTask = parseRepoAsync(ws, repoId, repoPath, repoName, maxCommits, abortController)
  activeParses.set(ws, { repoId, task: parseTask, abortController })
}

/**
 * 停止解析
 */
function handleStopParse(ws) {
  stopExistingParse(ws)
  ws.send(JSON.stringify({ type: 'parse_stopped' }))
}

/**
 * 异步解析仓库 — 分阶段推送进度和结果
 */
async function parseRepoAsync(ws, repoId, repoPath, repoName, maxCommits, abortController) {
  const startTime = Date.now()

  try {
    ws.send(JSON.stringify({
      type: 'progress',
      repoId,
      phase: 'parsing',
      current: 0,
      total: 1,
      message: '正在获取提交记录...'
    }))

    const commits = await getCommitsWithDiff(repoPath, maxCommits)

    if (abortController.signal.aborted) return

    ws.send(JSON.stringify({
      type: 'progress',
      repoId,
      phase: 'diffing',
      current: commits.length,
      total: commits.length,
      message: `已获取 ${commits.length} 次提交差异`
    }))

    // 分批推送部分结果（每 10 个 commit 一批），避免阻塞事件循环
    // NOTE: 每批调用 buildFileStocks 会重新遍历所有已处理 commits。
    // 对于大仓库（>1000 commits），应考虑改为增量构建或移入 Worker Thread。
    const BATCH_SIZE = 10
    for (let i = 0; i < commits.length; i += BATCH_SIZE) {
      if (abortController.signal.aborted) return

      const batch = commits.slice(i, Math.min(i + BATCH_SIZE, commits.length))

      // 使用 setImmediate 将 CPU 密集型计算放到下一个事件循环 tick，避免阻塞
      const stocks = await new Promise((resolve) => {
        setImmediate(() => {
          resolve(buildFileStocks(batch, repoId))
        })
      })

      ws.send(JSON.stringify({
        type: 'partial',
        repoId,
        stocks,
        latestCommit: batch[batch.length - 1]
      }))

      ws.send(JSON.stringify({
        type: 'progress',
        repoId,
        phase: 'building',
        current: Math.min(i + BATCH_SIZE, commits.length),
        total: commits.length,
        message: `正在生成K线数据 ${Math.min(i + BATCH_SIZE, commits.length)}/${commits.length}...`
      }))

      await new Promise(r => setTimeout(r, 0))
    }

    if (abortController.signal.aborted) return

    // 最终完整构建也使用 setImmediate 避免阻塞
    const finalStocks = await new Promise((resolve) => {
      setImmediate(() => {
        resolve(buildFileStocks(commits, repoId))
      })
    })

    ws.send(JSON.stringify({
      type: 'complete',
      repoId,
      repoName,
      stocks: finalStocks,
      totalCommits: commits.length,
      totalTime: Date.now() - startTime
    }))

    console.log(`[WebSocket] Parse complete for ${repoName}: ${commits.length} commits, ${finalStocks.length} stocks, ${Date.now() - startTime}ms`)

    // 保存到磁盘缓存
    const currentHead = await getHeadCommit(repoPath)
    saveCache(repoId, {
      repoName,
      repoPath,
      lastHead: currentHead,
      stocks: finalStocks,
      commitCount: commits.length,
    })

    // 解析完成后启动实时监视
    await startWatching(repoId, repoPath, repoName, ws)

  } catch (error) {
    console.error('[WebSocket] Parse error:', error)
    ws.send(JSON.stringify({
      type: 'error',
      repoId,
      message: error.message,
      code: 'PARSE_FAILED'
    }))
  } finally {
    activeParses.delete(ws)
  }
}

/**
 * 停止现有解析任务
 */
function stopExistingParse(ws) {
  const existing = activeParses.get(ws)
  if (existing) {
    existing.abortController.abort()
    activeParses.delete(ws)
  }
}

/**
 * 清理解析任务
 */
function cleanupParses(ws) {
  stopExistingParse(ws)
}