import { useCallback, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRepo } from '../hooks/useRepo'

interface RepoInfo {
  path: string
  name: string
}

export default function Home() {
  const navigate = useNavigate()
  const { startParsing, wsConnected } = useRepo()
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [customPath, setCustomPath] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)

  const handleSelectRepo = useCallback(
    async (repo: RepoInfo) => {
      setError(null)
      setVerifying(true)
      try {
        const res = await fetch(`/api/log?path=${encodeURIComponent(repo.path)}&limit=1`)
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.error || '连接失败')
        }
        const data = await res.json()
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('没有找到提交记录')
        }
        
        // 开始解析并跳转
        startParsing(repo.path, repo.name)
        navigate('/market')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '验证失败')
      } finally {
        setVerifying(false)
      }
    },
    [navigate, startParsing],
  )

  const handleBrowseFolder = useCallback(async () => {
    try {
      const dirHandle = await (window as unknown as { showDirectoryPicker: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read' })
      const name = dirHandle.name
      setSelectedFolder(name)
      setError(null)
      setVerifying(true)

      const res = await fetch(`/api/resolve?name=${encodeURIComponent(name)}`)
      const data = await res.json()

      if (data.repos && data.repos.length > 0) {
        if (data.repos.length === 1) {
          await handleSelectRepo(data.repos[0])
        } else {
          setRepos(data.repos)
          setLoading(false)
        }
      } else {
        setError(`未找到 "${name}" 文件夹下的 Git 仓库，请手动输入路径`)
        setRepos([])
        setLoading(false)
      }
      setVerifying(false)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : '选择失败')
      setVerifying(false)
    }
  }, [handleSelectRepo])

  // 使用 useEffect 获取仓库列表
  useEffect(() => {
    let cancelled = false;
    
    const fetchRepos = async () => {
      try {
        const r = await fetch('/api/discover')
        const data = await r.json()
        if (!cancelled) {
          setRepos(data.repos || [])
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setError('无法连接后端服务器，请先运行: npm run server')
          setLoading(false)
        }
      }
    }

    fetchRepos()
    
    return () => {
      cancelled = true;
    }
  }, [])

  const handleCustomPath = useCallback(async () => {
    if (!customPath.trim()) return
    setError(null)
    const repo: RepoInfo = {
      path: customPath.trim(),
      name: customPath.trim().split(/[\\/]/).filter(Boolean).pop() || customPath.trim(),
    }
    await handleSelectRepo(repo)
  }, [customPath, handleSelectRepo])

  const filtered = repos.filter(
    (r) => r.name.toLowerCase().includes(search.toLowerCase()) || r.path.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="h-full flex flex-col grid-bg relative overflow-hidden">
      <div className="absolute top-20 left-20 w-72 h-72 bg-ex-accent/5 rounded-full blur-3xl" />
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-ex-green/5 rounded-full blur-3xl" />

      {/* Header */}
      <div className="relative z-10 px-8 py-6 flex items-center justify-between border-b border-ex-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-[Orbitron] text-2xl font-black text-ex-heading glow-accent tracking-wider">CODEX</span>
          <span className="text-xs text-ex-dim font-mono tracking-[0.2em]">代码交易所</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-ex-green' : 'bg-ex-red'}`} />
          <span className="text-xs font-mono text-ex-dim">
            {wsConnected ? '已连接' : '未连接'}
          </span>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-auto p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Title */}
          <div className="text-center space-y-2">
            <h1 className="text-ex-heading text-2xl font-semibold">选择 Git 仓库</h1>
            <p className="text-ex-dim text-sm">每个文件是一支股票，每次提交是一根K线。代码增删即涨跌。</p>
          </div>

          {/* Browse Button */}
          <div className="flex justify-center">
            <button
              onClick={handleBrowseFolder}
              disabled={!wsConnected}
              className="group relative px-8 py-3 bg-ex-accent/10 border border-ex-accent/30 rounded-lg
                text-ex-accent font-mono text-sm tracking-wider
                hover:bg-ex-accent/20 hover:border-ex-accent/50 transition-all duration-300 cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                选择文件夹
              </span>
            </button>
          </div>

          {selectedFolder && (
            <div className="text-ex-gold text-sm font-mono text-center flex items-center justify-center gap-2">
              <span className={`w-2 h-2 rounded-full bg-ex-gold ${verifying ? 'pulse-glow' : ''}`} />
              已选: <span className="font-semibold">{selectedFolder}</span>
              {verifying && <span className="text-ex-dim text-xs">（正在搜索中...）</span>}
            </div>
          )}

          {/* Search */}
          {repos.length > 5 && (
            <div className="relative max-w-md mx-auto">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ex-dim" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索仓库名称或路径..."
                className="w-full bg-ex-surface border border-ex-border rounded-lg pl-10 pr-4 py-2.5
                  text-sm font-mono text-ex-heading placeholder:text-ex-dim
                  focus:outline-none focus:border-ex-accent/50 transition-colors"
              />
            </div>
          )}

          {/* Custom path input */}
          <div className="flex gap-2 max-w-lg mx-auto">
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCustomPath()}
              placeholder="手动输入仓库路径，如 D:\projects\my-repo"
              className="flex-1 bg-ex-surface border border-ex-border rounded-lg px-4 py-2.5
                text-sm font-mono text-ex-heading placeholder:text-ex-dim
                focus:outline-none focus:border-ex-accent/50 transition-colors"
            />
            <button
              onClick={handleCustomPath}
              disabled={!customPath.trim() || verifying || !wsConnected}
              className="px-5 py-2.5 bg-ex-accent/20 border border-ex-accent/40 rounded-lg
                text-ex-accent font-mono text-sm disabled:opacity-30 disabled:cursor-not-allowed
                hover:bg-ex-accent/30 transition-colors cursor-pointer"
            >
              {verifying ? '...' : '验证'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-ex-red/10 border border-ex-red/30 rounded-lg px-4 py-3 text-ex-red text-sm font-mono text-center">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-8">
              <div className="inline-flex items-center gap-3 text-ex-dim font-mono text-sm">
                <span className="w-2 h-2 rounded-full bg-ex-accent pulse-glow" />
                正在扫描本地 Git 仓库...
              </div>
            </div>
          )}

          {/* Repo grid */}
          {!loading && (
            <>
              {filtered.length > 0 && (
                <div className="text-xs text-ex-dim font-mono">发现 {filtered.length} 个仓库</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filtered.map((repo) => (
                  <button
                    key={repo.path}
                    onClick={() => handleSelectRepo(repo)}
                    disabled={!wsConnected}
                    className="bg-ex-surface border border-ex-border rounded-lg p-4 text-left
                      hover:border-ex-accent/50 hover:bg-ex-panel/50 transition-all group cursor-pointer
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-ex-accent/10 flex items-center justify-center shrink-0
                        group-hover:bg-ex-accent/20 transition-colors">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ex-accent">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-ex-heading font-mono text-sm font-semibold truncate group-hover:text-ex-accent transition-colors">
                          {repo.name}
                        </div>
                        <div className="text-ex-dim font-mono text-xs truncate">{repo.path}</div>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ex-dim group-hover:text-ex-accent transition-colors shrink-0">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>

              {repos.length === 0 && !loading && (
                <div className="text-center py-12 space-y-3">
                  <div className="text-ex-dim text-lg">未发现 Git 仓库</div>
                  <div className="text-ex-dim text-sm font-mono">请在上方手动输入仓库路径</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
