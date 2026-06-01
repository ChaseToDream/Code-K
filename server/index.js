import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { homedir } from 'node:os'

function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoPath,
      env: { ...process.env, LANG: 'en_US.UTF-8' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')))
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) return reject(new Error(`git ${args.join(' ')} failed: ${stderr}`))
      resolve(stdout)
    })
    child.on('error', reject)
  })
}

// Scan common directories for git repos
function findRepos(dir, depth = 0, maxDepth = 2) {
  if (depth > maxDepth) return []
  const repos = []
  try {
    // Check if current dir is a git repo
    if (existsSync(join(dir, '.git'))) {
      repos.push({ path: dir, name: dir.split(/[\\/]/).filter(Boolean).pop() || dir })
      return repos // Don't go deeper if this is a repo
    }
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        try {
          const fullPath = join(dir, entry.name)
          statSync(fullPath) // verify accessible
          repos.push(...findRepos(fullPath, depth + 1, maxDepth))
        } catch { /* skip */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return repos
}

async function handleResolve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const name = url.searchParams.get('name')
  if (!name) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: '缺少文件夹名' }))
  }

  // Search for folders matching the name across accessible locations
  const searchRoots = [
    homedir(),
    process.env.USERPROFILE || '',
    join(process.env.USERPROFILE || '', 'Desktop'),
    join(process.env.USERPROFILE || '', 'Documents'),
    join(process.env.USERPROFILE || '', 'Downloads'),
    join(process.env.USERPROFILE || '', 'Source'),
    join(process.env.USERPROFILE || '', 'source'),
    join(process.env.USERPROFILE || '', 'code'),
    join(process.env.USERPROFILE || '', 'Code'),
    join(process.env.USERPROFILE || '', 'projects'),
    join(process.env.USERPROFILE || '', 'Projects'),
    join(process.env.USERPROFILE || '', 'workspace'),
    join(process.env.USERPROFILE || '', 'Workspace'),
    join(process.env.USERPROFILE || '', 'dev'),
    join(process.env.USERPROFILE || '', 'Dev'),
    join(process.env.USERPROFILE || '', 'git'),
    join(process.env.USERPROFILE || '', 'Git'),
    process.env.HOME || '',
    // Windows drive letters (common locations)
    'D:', 'E:', 'F:', 'G:',
    'D:\\codeFile', 'D:\\projects', 'D:\\workspace', 'D:\\dev',
    'D:\\code', 'D:\\source',
  ].filter(Boolean)

  const uniqueRoots = [...new Set(searchRoots)]
  const results = []

  console.log(`[resolve] Searching for "${name}" in ${uniqueRoots.length} roots`)

  function scanDir(dir, depth = 0, maxDepth = 5) {
    if (depth > maxDepth || results.length >= 30) return
    try {
      const dirName = dir.split(/[\\/]/).pop() || ''
      // Check if this is the target folder AND has .git
      if (dirName.toLowerCase() === name.toLowerCase() && existsSync(join(dir, '.git'))) {
        results.push({ path: dir, name: dirName })
        console.log(`[resolve] Found: ${dir}`)
        return
      }
      // Don't recurse if we found it
      if (results.length >= 30) return

      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (results.length >= 30) break
        if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules') && !entry.name.startsWith('.git')) {
          try {
            scanDir(join(dir, entry.name), depth + 1, maxDepth)
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  for (const root of uniqueRoots) {
    if (existsSync(root)) scanDir(root)
  }

  console.log(`[resolve] Total found: ${results.length}`)
  res.json({ repos: results, searched: uniqueRoots.filter(r => existsSync(r)) })
}

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

  // Deduplicate
  const uniqueDirs = [...new Set(scanDirs)]
  const allRepos = []
  for (const dir of uniqueDirs) {
    if (existsSync(dir)) {
      allRepos.push(...findRepos(dir))
    }
  }

  // Deduplicate by path
  const seen = new Set()
  const uniqueRepos = allRepos.filter((r) => {
    if (seen.has(r.path)) return false
    seen.add(r.path)
    return true
  })

  res.json({ repos: uniqueRepos })
}

async function handleGetLog(req, res, repoPath) {
  const limit = new URL(req.url, `http://${req.headers.host}`).searchParams.get('limit') || '300'
  const logOutput = await runGit(repoPath, [
    'log', `--max-count=${limit}`, '--reverse',
    '--format=%H%x00%an%x00%at%x00%s',
  ])

  const commits = []
  for (const line of logOutput.split('\n').filter(Boolean)) {
    const [hash, author, timestamp, message] = line.split('\0')
    commits.push({ hash, author, timestamp: parseInt(timestamp), message })
  }
  res.json(commits)
}

async function handleGetDiff(req, res, repoPath) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const hash = url.searchParams.get('hash')
  const parentHash = url.searchParams.get('parentHash')

  if (!parentHash) {
    const numstat = await runGit(repoPath, ['diff-tree', '--numstat', '--root', '-r', hash])
    return res.json(parseNumstat(numstat))
  }

  const numstat = await runGit(repoPath, ['diff-tree', '--numstat', '-r', parentHash, hash])
  res.json(parseNumstat(numstat))
}

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
    } else if (req.method === 'POST' && url.pathname === '/api/parse') {
      res.json({ commits: [], diffs: [] }) // legacy endpoint
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

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`CODEX API 服务器已启动: http://localhost:${PORT}`)
})
