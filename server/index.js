import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { WebSocketServer } from 'ws'
import { runGit } from './git-utils.js'
import { startWatching, stopWatching, cleanupAllWatchers } from './watcher.js'

// 获取提交列表
async function getCommits(repoPath, limit = 300) {
  const logOutput = await runGit(repoPath, [
    'log', `--max-count=${limit}`, '--reverse',
    '--format=%H%x00%an%x00%at%x00%s',
  ])

  const commits = []
  for (const line of logOutput.split('\n').filter(Boolean)) {
    const [hash, author, timestamp, message] = line.split('\0')
    commits.push({ hash, author, timestamp: parseInt(timestamp), message })
  }
  return commits
}

// 获取文件差异
async function getDiff(repoPath, hash, parentHash) {
  let numstat
  if (!parentHash) {
    numstat = await runGit(repoPath, ['diff-tree', '--numstat', '--root', '-r', hash])
  } else {
    numstat = await runGit(repoPath, ['diff-tree', '--numstat', '-r', parentHash, hash])
  }
  return parseNumstat(numstat)
}

// 解析 numstat 输出
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

// 生成仓库ID
function generateRepoId(repoPath) {
  return Buffer.from(repoPath).toString('base64').slice(0, 12)
}

// 构建股票数据（复用原有逻辑）
function buildFileStocks(commits, repoId) {
  const fileData = new Map()

  // commits are newest-first from git log, reverse for chronological order
  const chronological = [...commits].reverse()

  for (let i = 0; i < chronological.length; i++) {
    const diff = chronological[i]
    const { commit, files } = diff

    for (const file of files) {
      let state = fileData.get(file.path)

      if (!state) {
        const linesAfter = file.additions - file.deletions
        state = {
          path: file.path,
          candles: [],
          currentLines: 0,
          firstCommitIdx: i,
          lastSeenIdx: i,
          totalAdditions: 0,
          totalDeletions: 0,
          isDelisted: false,
        }
        fileData.set(file.path, state)

        const open = 0
        const close = Math.max(0, linesAfter)
        state.candles.push({
          time: commit.timestamp,
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
          volume: file.additions + file.deletions,
          commitMessage: commit.message,
          commitHash: commit.oid.slice(0, 8),
          author: commit.author,
        })
        state.currentLines = close
        state.totalAdditions += file.additions
        state.totalDeletions += file.deletions
      } else {
        state.lastSeenIdx = i
        const open = state.currentLines
        const change = file.additions - file.deletions
        const close = Math.max(0, open + change)

        state.candles.push({
          time: commit.timestamp,
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
          volume: file.additions + file.deletions,
          commitMessage: commit.message,
          commitHash: commit.oid.slice(0, 8),
          author: commit.author,
        })

        state.currentLines = close
        state.totalAdditions += file.additions
        state.totalDeletions += file.deletions

        if (close === 0 && file.deletions > 0) {
          state.isDelisted = true
        }
      }
    }
  }

  const stocks = []

  for (const [, state] of fileData) {
    if (state.candles.length === 0) continue

    const firstCandle = state.candles[0]
    const lastCandle = state.candles[state.candles.length - 1]

    const changePercent = lastCandle.open > 0
      ? ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100
      : (lastCandle.close > 0 ? 100 : 0)

    const ticker = generateTicker(state.path)

    let status = 'active'
    if (state.candles.length === 1 || state.firstCommitIdx === chronological.length - 1) {
      status = 'ipo'
    }
    if (state.isDelisted) {
      status = 'delisted'
    }

    stocks.push({
      path: state.path,
      ticker,
      candles: state.candles,
      currentLines: state.currentLines,
      status,
      firstCommit: {
        oid: firstCandle.commitHash,
        message: firstCandle.commitMessage,
        author: firstCandle.author,
        timestamp: firstCandle.time,
      },
      lastCommit: {
        oid: lastCandle.commitHash,
        message: lastCandle.commitMessage,
        author: lastCandle.author,
        timestamp: lastCandle.time,
      },
      totalAdditions: state.totalAdditions,
      totalDeletions: state.totalDeletions,
      changePercent,
      repoId,
    })
  }

  stocks.sort((a, b) => b.currentLines - a.currentLines)
  return stocks
}

// 生成股票代码
function generateTicker(path) {
  const parts = path.split('/')
  const filename = parts[parts.length - 1]
  const name = filename.replace(/\.[^.]+$/, '').toUpperCase()
  const ext = filename.includes('.') ? filename.split('.').pop().toUpperCase() : ''

  const shortName = name.slice(0, 6)
  return ext ? `${shortName}.${ext.slice(0, 3)}` : shortName
}

// 扫描本地 Git 仓库
function findRepos(dir, depth = 0, maxDepth = 2) {
  if (depth > maxDepth) return []
  const repos = []
  try {
    if (existsSync(join(dir, '.git'))) {
      repos.push({ path: dir, name: dir.split(/[\\/]/).filter(Boolean).pop() || dir })
      return repos
    }
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        try {
          const fullPath = join(dir, entry.name)
          statSync(fullPath)
          repos.push(...findRepos(fullPath, depth + 1, maxDepth))
        } catch { /* skip */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return repos
}

// HTTP API 处理函数
async function handleDiscover(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const customPath = url.searchParams.get('path')

  let scanDirs = [
    homedir(),
    process.env.USERPROFILE || '',
    join(process.env.USERPROFILE || '', 'Desktop'),
    join(process.env.USERPROFILE || '', 'Documents'),
    process.env.HOME || '',
  ].filter(Boolean)

  if (customPath) {
    scanDirs = [customPath]
  }

  const uniqueDirs = [...new Set(scanDirs)]
  const allRepos = []
  for (const dir of uniqueDirs) {
    if (existsSync(dir)) {
      allRepos.push(...findRepos(dir))
    }
  }

  const seen = new Set()
  const uniqueRepos = allRepos.filter((r) => {
    if (seen.has(r.path)) return false
    seen.add(r.path)
    return true
  })

  res.json({ repos: uniqueRepos })
}

async function handleResolve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const name = url.searchParams.get('name')
  if (!name) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: '缺少文件夹名' }))
  }

  // 只扫描常见的代码目录，深度限制为2层
  const searchRoots = [
    join(process.env.USERPROFILE || homedir(), 'code'),
    join(process.env.USERPROFILE || homedir(), 'Code'),
    join(process.env.USERPROFILE || homedir(), 'projects'),
    join(process.env.USERPROFILE || homedir(), 'Projects'),
    join(process.env.USERPROFILE || homedir(), 'workspace'),
    join(process.env.USERPROFILE || homedir(), 'Workspace'),
    join(process.env.USERPROFILE || homedir(), 'dev'),
    join(process.env.USERPROFILE || homedir(), 'Dev'),
    join(process.env.USERPROFILE || homedir(), 'source'),
    join(process.env.USERPROFILE || homedir(), 'Source'),
    join(process.env.USERPROFILE || homedir(), 'Desktop'),
    join(process.env.USERPROFILE || homedir(), 'Documents'),
    'D:\\codeFile',
    'D:\\projects',
  ].filter(Boolean)

  const uniqueRoots = [...new Set(searchRoots)]
  const results = []

  // 限制扫描深度和时间
  const startTime = Date.now()
  const MAX_SCAN_TIME = 5000 // 5秒超时

  function scanDir(dir, depth = 0, maxDepth = 2) {
    // 超时检查
    if (Date.now() - startTime > MAX_SCAN_TIME) return
    if (depth > maxDepth || results.length >= 10) return
    
    try {
      const dirName = dir.split(/[\\/]/).pop() || ''
      if (dirName.toLowerCase() === name.toLowerCase() && existsSync(join(dir, '.git'))) {
        results.push({ path: dir, name: dirName })
        return
      }
      if (results.length >= 10) return

      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (results.length >= 10 || Date.now() - startTime > MAX_SCAN_TIME) break
        if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules') && !entry.name.startsWith('.git')) {
          try {
            scanDir(join(dir, entry.name), depth + 1, maxDepth)
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  for (const root of uniqueRoots) {
    if (results.length >= 10 || Date.now() - startTime > MAX_SCAN_TIME) break
    if (existsSync(root)) scanDir(root)
  }

  res.json({ repos: results, searched: uniqueRoots.filter(r => existsSync(r)) })
}

async function handleGetLog(req, res, repoPath) {
  const limit = new URL(req.url, `http://${req.headers.host}`).searchParams.get('limit') || '300'
  const commits = await getCommits(repoPath, parseInt(limit))
  res.json(commits)
}

async function handleGetDiff(req, res, repoPath) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const hash = url.searchParams.get('hash')
  const parentHash = url.searchParams.get('parentHash')

  const files = await getDiff(repoPath, hash, parentHash)
  res.json(files)
}

// 获取文件内容（用于diff详情）
async function getFileContent(repoPath, commitHash, filePath) {
  try {
    const content = await runGit(repoPath, ['show', `${commitHash}:${filePath}`])
    return content
  } catch {
    return null
  }
}

// 活跃的解析任务
const activeParses = new Map()

// WebSocket 消息处理
function setupWebSocket(wss) {
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

// 开始解析仓库
async function handleStartParse(ws, message) {
  const { repoPath, repoName, maxCommits = 300 } = message

  // 验证仓库
  if (!existsSync(join(repoPath, '.git'))) {
    ws.send(JSON.stringify({
      type: 'error',
      message: '不是有效的Git仓库',
      code: 'INVALID_REPO'
    }))
    return
  }

  // 生成仓库ID
  const repoId = generateRepoId(repoPath)

  // 停止之前的解析
  stopExistingParse(ws)

  // 开始新解析
  const abortController = new AbortController()
  const parseTask = parseRepoAsync(ws, repoId, repoPath, repoName, maxCommits, abortController)
  activeParses.set(ws, { repoId, task: parseTask, abortController })

  // 发送开始确认
  ws.send(JSON.stringify({
    type: 'parse_started',
    repoId,
    repoName
  }))
}

// 停止解析
function handleStopParse(ws) {
  stopExistingParse(ws)
  ws.send(JSON.stringify({ type: 'parse_stopped' }))
}

// 停止现有解析任务
function stopExistingParse(ws) {
  const existing = activeParses.get(ws)
  if (existing) {
    existing.abortController.abort()
    activeParses.delete(ws)
  }
}

// 清理解析任务
function cleanupParses(ws) {
  stopExistingParse(ws)
}

// 异步解析仓库
async function parseRepoAsync(ws, repoId, repoPath, repoName, maxCommits, abortController) {
  const startTime = Date.now()

  try {
    // 1. 获取提交列表
    ws.send(JSON.stringify({
      type: 'progress',
      repoId,
      phase: 'parsing',
      current: 0,
      total: 1,
      message: '正在获取提交记录...'
    }))

    const commits = await getCommits(repoPath, maxCommits)

    if (abortController.signal.aborted) return

    // 2. 逐个获取diff，每10个推送一次部分结果
    const allCommits = []
    const BATCH_SIZE = 10

    for (let i = 0; i < commits.length; i++) {
      if (abortController.signal.aborted) return

      const commit = commits[i]
      const parent = i < commits.length - 1 ? commits[i + 1] : null
      const files = await getDiff(repoPath, commit.hash, parent?.hash)

      allCommits.push({
        commit: {
          oid: commit.hash,
          message: commit.message,
          author: commit.author,
          timestamp: commit.timestamp
        },
        files
      })

      // 每BATCH_SIZE个commit推送一次部分结果
      if (i % BATCH_SIZE === 0 || i === commits.length - 1) {
        const stocks = buildFileStocks(allCommits, repoId)

        ws.send(JSON.stringify({
          type: 'partial',
          repoId,
          stocks,
          latestCommit: allCommits[allCommits.length - 1]
        }))

        ws.send(JSON.stringify({
          type: 'progress',
          repoId,
          phase: 'diffing',
          current: i + 1,
          total: commits.length,
          message: `已获取 ${i + 1}/${commits.length} 次提交差异`
        }))

        // 让出事件循环
        await new Promise(r => setTimeout(r, 0))
      }
    }

    if (abortController.signal.aborted) return

    // 3. 构建最终结果
    ws.send(JSON.stringify({
      type: 'progress',
      repoId,
      phase: 'building',
      current: 1,
      total: 1,
      message: '正在生成K线数据...'
    }))

    const finalStocks = buildFileStocks(allCommits, repoId)

    ws.send(JSON.stringify({
      type: 'complete',
      repoId,
      repoName,
      stocks: finalStocks,
      totalCommits: commits.length,
      totalTime: Date.now() - startTime
    }))

    console.log(`[WebSocket] Parse complete for ${repoName}: ${commits.length} commits, ${finalStocks.length} stocks, ${Date.now() - startTime}ms`)

    // 4. 解析完成后启动实时监视
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

// 处理diff详情请求
async function handleRequestDiff(ws, message) {
  const { repoPath, commitHash, filePath } = message

  try {
    // 获取当前版本内容
    const newContent = await getFileContent(repoPath, commitHash, filePath)

    // 获取父提交的文件内容
    let oldContent = ''
    try {
      const parentHash = `${commitHash}~1`
      oldContent = await getFileContent(repoPath, parentHash, filePath) || ''
    } catch {
      oldContent = ''
    }

    // 计算差异
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')
    const additions = newLines.length - oldLines.filter(line => newLines.includes(line)).length
    const deletions = oldLines.length - oldLines.filter(line => newLines.includes(line)).length

    ws.send(JSON.stringify({
      type: 'diff_detail',
      commitHash,
      filePath,
      oldContent,
      newContent,
      additions: Math.max(0, additions),
      deletions: Math.max(0, deletions)
    }))
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Failed to get diff: ${error.message}`,
      code: 'DIFF_FAILED'
    }))
  }
}

// 创建 HTTP 服务器
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // /api/discover - no path needed
    if (req.method === 'GET' && url.pathname === '/api/discover') {
      return await handleDiscover(req, res)
    }

    // /api/resolve?name=<folder_name> - search for folder by name
    if (req.method === 'GET' && url.pathname === '/api/resolve') {
      return await handleResolve(req, res)
    }

    const repoPath = url.searchParams.get('path')
    if (!repoPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: '缺少路径参数' }))
    }

    if (!existsSync(join(repoPath, '.git'))) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: '不是有效的 Git 仓库' }))
    }

    if (req.method === 'GET' && (url.pathname === '/api/repos' || url.pathname === '/api/log')) {
      await handleGetLog(req, res, repoPath)
    } else if (req.method === 'GET' && url.pathname === '/api/diff') {
      await handleGetDiff(req, res, repoPath)
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  } catch (err) {
    console.error('API Error:', err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ server })
setupWebSocket(wss)

// 启动服务器
const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`CODEX API 服务器已启动: http://localhost:${PORT}`)
  console.log(`WebSocket 服务器已启动: ws://localhost:${PORT}`)
})

// 进程退出时清理监视器
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...')
  cleanupAllWatchers()
  process.exit(0)
})

process.on('SIGTERM', () => {
  cleanupAllWatchers()
  process.exit(0)
})
