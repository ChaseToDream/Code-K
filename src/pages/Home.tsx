import { useCallback, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRepo } from '../hooks/useRepo'
import { useLocalParser } from '../hooks/useLocalParser'

export default function Home() {
  const navigate = useNavigate()
  const { wsConnected, startParsing } = useRepo()
  const { parseLocalRepo } = useLocalParser()
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [repos, setRepos] = useState<Array<{ path: string; name: string }>>([])

  useEffect(() => {
    let cancelled = false
    
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
          setLoading(false)
        }
      }
    }

    fetchRepos()
    
    return () => {
      cancelled = true
    }
  }, [])

  const handleSelectRepo = useCallback(
    async (repoPath: string) => {
      setError(null)
      setVerifying(true)
      try {
        const res = await fetch(`/api/log?path=${encodeURIComponent(repoPath)}&limit=1`)
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.error || '连接失败')
        }
        const data = await res.json()
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('没有找到提交记录')
        }

        const name = repoPath.split(/[\\/]/).pop() || repoPath
        startParsing(repoPath, name)
        navigate('/market')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '验证失败')
      } finally {
        setVerifying(false)
      }
    },
    [navigate, startParsing],
  )

  /**
   * 检测是否在 Electron 环境中
   */
  const isElectron = useCallback(() => {
    return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).electron
  }, [])

  const handleBrowseFolder = useCallback(async () => {
    try {
      setError(null)
      setVerifying(true)

      // Electron 环境下使用原生文件选择对话框
      if (isElectron()) {
        const electron = (window as unknown as { electron: { selectFolder: () => Promise<string | null> } }).electron
        const folderPath = await electron.selectFolder()
        if (!folderPath) {
          setVerifying(false)
          return
        }

        const name = folderPath.split(/[\\/]/).pop() || folderPath
        setSelectedFolder(name)

        // 通过后端 API 验证并解析
        const res = await fetch(`/api/log?path=${encodeURIComponent(folderPath)}&limit=1`)
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.error || '不是有效的 Git 仓库')
        }

        // 触发服务端解析并通过 WebSocket 获取数据
        startParsing(folderPath, name)
        navigate('/market')
        setVerifying(false)
        return
      }

      // 浏览器环境使用 File System Access API
      const dirHandle = await (window as unknown as { showDirectoryPicker: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' })
      const name = dirHandle.name
      setSelectedFolder(name)

      // 检查是否存在 .git 文件夹
      let hasGit = false
      try {
        await dirHandle.getDirectoryHandle('.git', { create: false })
        hasGit = true
      } catch {
        hasGit = false
      }

      if (!hasGit) {
        setError(`"${name}" 不是 Git 仓库（未找到 .git 文件夹）`)
        setVerifying(false)
        return
      }

      // 使用浏览器端解析
      await parseLocalRepo(dirHandle)
      navigate('/market')
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setVerifying(false)
        return
      }
      setError(err instanceof Error ? err.message : '选择失败')
      setVerifying(false)
    }
  }, [parseLocalRepo, navigate, isElectron])

  const handleRepoClick = useCallback(async (repo: { path: string; name: string }) => {
    await handleSelectRepo(repo.path)
  }, [handleSelectRepo])

  return (
    <div className="h-full flex flex-col grid-bg relative overflow-hidden">
      <div className="absolute top-20 left-20 w-72 h-72 bg-ex-accent/5 rounded-full blur-3xl" />
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-ex-green/5 rounded-full blur-3xl" />

      <div className="relative z-10 px-8 py-6 flex items-center justify-between border-b border-ex-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-[Orbitron] text-2xl font-black text-ex-heading glow-accent tracking-wider">Code-K</span>
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
          <div className="text-center space-y-2">
            <h1 className="text-ex-heading text-2xl font-semibold">选择 Git 仓库</h1>
            <p className="text-ex-dim text-sm">每个文件是一支股票，每次提交是一根K线。代码增删即涨跌。</p>
          </div>

          <div className="flex justify-center">
            <button
              onClick={handleBrowseFolder}
              disabled={verifying}
              className="group relative px-8 py-3 bg-ex-accent/10 border border-ex-accent/30 rounded-lg
                text-ex-accent font-mono text-sm tracking-wider
                hover:bg-ex-accent/20 hover:border-ex-accent/50 transition-all duration-300 cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-3">
                {verifying ? (
                  <>
                    <span className="w-4 h-4 border-2 border-ex-accent border-t-transparent rounded-full animate-spin" />
                    正在验证...
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    选择文件夹
                  </>
                )}
              </span>
            </button>
          </div>

          {selectedFolder && (
            <div className="text-ex-gold text-sm font-mono text-center flex items-center justify-center gap-2">
              <span className={`w-2 h-2 rounded-full bg-ex-gold ${verifying ? 'pulse-glow' : ''}`} />
              已选: <span className="font-semibold">{selectedFolder}</span>
            </div>
          )}

          {error && (
            <div className="bg-ex-red/10 border border-ex-red/30 rounded-lg px-4 py-3 text-ex-red text-sm font-mono text-center">
              {error}
            </div>
          )}

          {loading && (
            <div className="text-center py-8">
              <div className="inline-flex items-center gap-3 text-ex-dim font-mono text-sm">
                <span className="w-2 h-2 rounded-full bg-ex-accent pulse-glow" />
                正在扫描本地 Git 仓库...
              </div>
            </div>
          )}

          {!loading && repos.length > 0 && (
            <>
              <div className="text-xs text-ex-dim font-mono">发现 {repos.length} 个仓库</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {repos.map((repo) => (
                  <button
                    key={repo.path}
                    onClick={() => handleRepoClick(repo)}
                    disabled={verifying}
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
            </>
          )}

          {!loading && repos.length === 0 && !error && (
            <div className="text-center py-12 space-y-3">
              <div className="text-ex-dim text-lg">未发现 Git 仓库</div>
              <div className="text-ex-dim text-sm font-mono">请点击上方按钮选择包含 .git 的文件夹</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
