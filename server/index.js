/**
 * Code-K 后端入口 — HTTP 路由 + WebSocket 服务器
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { cleanupAllWatchers } from './watcher.js'
import { handleDiscover, handleResolve } from './routes/discover.js'
import { handleGetLog, handleGetDiff, validateRepoPath } from './routes/repo.js'
import { setupWebSocket } from './ws-handler.js'
import { deleteCache, clearAllCache, getCacheStats } from './services/cache.js'
import { generateRepoId } from './lib/kline-core.js'

// 创建 HTTP 服务器
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // /api/discover — 不需要 path 参数
    if (req.method === 'GET' && url.pathname === '/api/discover') {
      return await handleDiscover(req, res)
    }

    // /api/resolve?name=<folder_name> — 按文件夹名搜索
    if (req.method === 'GET' && url.pathname === '/api/resolve') {
      return await handleResolve(req, res)
    }

    // /api/cache/stats — 缓存统计
    if (req.method === 'GET' && url.pathname === '/api/cache/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(getCacheStats()))
    }

    // DELETE /api/cache — 清除缓存
    if (req.method === 'DELETE' && url.pathname === '/api/cache') {
      const targetPath = url.searchParams.get('path')
      if (targetPath) {
        const repoId = generateRepoId(targetPath)
        const deleted = deleteCache(repoId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ deleted }))
      }
      const count = clearAllCache()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ cleared: count }))
    }

    const repoPath = url.searchParams.get('path')
    if (!validateRepoPath(req, res, repoPath)) return

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
  console.log(`Code-K API 服务器已启动: http://localhost:${PORT}`)
  console.log(`WebSocket 服务器已启动: ws://localhost:${PORT}`)
})

// 进程退出时清理
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...')
  cleanupAllWatchers()
  process.exit(0)
})

process.on('SIGTERM', () => {
  cleanupAllWatchers()
  process.exit(0)
})