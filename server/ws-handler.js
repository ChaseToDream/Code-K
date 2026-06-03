/**
 * WebSocket 处理器 — 消息路由与解析任务编排
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { startWatching, stopWatching } from './watcher.js'
import { getCommitsWithDiff, buildFileStocks, generateRepoId } from './services/parser.js'
import { handleRequestDiff } from './routes/diff.js'
import { loadCache, saveCache, getHeadCommit } from './services/cache.js'

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
  const { repoPath, repoName, maxCommits = 300 } = message

  if (!existsSync(join(repoPath, '.git'))) {
    ws.send(JSON.stringify({
      type: 'error',
      message: '不是有效的Git仓库',
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
    const BATCH_SIZE = 10
    for (let i = 0; i < commits.length; i += BATCH_SIZE) {
      if (abortController.signal.aborted) return

      const batch = commits.slice(0, Math.min(i + BATCH_SIZE, commits.length))
      const stocks = buildFileStocks(batch, repoId)

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

    const finalStocks = buildFileStocks(commits, repoId)

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