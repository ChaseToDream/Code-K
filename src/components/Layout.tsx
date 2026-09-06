import { type ReactNode, useCallback, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useRepo } from '../hooks/useRepo'
import { useWebSocket } from '../hooks/useWebSocket'
import { useShortcuts } from '../hooks/useShortcuts'
import type { FileStock } from '../lib/types'
import ShortcutsHelp from './ShortcutsHelp'

interface LayoutProps {
  children: ReactNode
}

/** Ticker 条只展示成交量最高的前 N 支，避免全量渲染 */
const TICKER_LIMIT = 30

/** 空数组常量，避免 `|| []` 每次渲染产生新引用导致 useMemo 失效 */
const EMPTY_STOCKS: FileStock[] = []

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const isHome = location.pathname === '/'
  const { activeRepo, repos, wsConnected } = useRepo()
  const { reconnect } = useWebSocket()

  const stocks = activeRepo?.stocks ?? EMPTY_STOCKS
  const repoName = activeRepo?.name || ''

  // 一次遍历统计三种状态数量
  const { activeStocks, ipoStocks, delistedStocks } = useMemo(() => {
    let active = 0
    let ipo = 0
    let delisted = 0
    for (const s of stocks) {
      if (s.status === 'active') active++
      else if (s.status === 'ipo') ipo++
      else if (s.status === 'delisted') delisted++
    }
    return { activeStocks: active, ipoStocks: ipo, delistedStocks: delisted }
  }, [stocks])

  // Ticker 只取成交量 Top N，复制两份实现无缝滚动
  const tickerStocks = useMemo(() => {
    return [...stocks]
      .sort((a, b) => (b.totalAdditions + b.totalDeletions) - (a.totalAdditions + a.totalDeletions))
      .slice(0, TICKER_LIMIT)
  }, [stocks])

  // 存在后端解析模式的仓库时才允许手动重连 WebSocket
  const hasBackendRepo = useMemo(() => repos.some(r => r.parseMode === 'backend'), [repos])

  // 快捷键处理
  const handleEscape = useCallback(() => {
    // 如果在详情页，返回行情页
    if (location.pathname.startsWith('/stock/')) {
      navigate('/market')
    }
  }, [location.pathname, navigate])

  const handleSearch = useCallback(() => {
    // 优先聚焦行情页搜索框，退化为页面中第一个文本输入框
    const searchInput = (document.getElementById('market-search-input')
      || document.querySelector('input[type="text"]')) as HTMLInputElement | null
    if (searchInput) {
      searchInput.focus()
    }
  }, [])

  useShortcuts({
    onEscape: handleEscape,
    onSearch: handleSearch,
  })

  return (
    <div className="h-full flex flex-col">
      {/* Ticker Tape Header */}
      {!isHome && tickerStocks.length > 0 && (
        <div className="bg-ex-surface border-b border-ex-border overflow-hidden h-8 flex items-center shrink-0">
          <div className="ticker-tape flex whitespace-nowrap gap-8 text-xs font-mono">
            {[...tickerStocks, ...tickerStocks].map((stock, i) => {
              const isUp = stock.changePercent >= 0
              return (
                <span key={`${stock.path}-${i}`} className="flex items-center gap-2">
                  <span className="text-ex-heading font-semibold">{stock.ticker}</span>
                  <span className="text-ex-dim">{stock.currentLines}</span>
                  <span className={isUp ? 'text-ex-green' : 'text-ex-red'}>
                    {isUp ? '+' : ''}{stock.changePercent.toFixed(1)}%
                  </span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Nav Bar */}
      {!isHome && (
        <nav className="bg-ex-surface border-b border-ex-border px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-3 text-ex-heading no-underline hover:opacity-80 transition-opacity">
              <span className="font-[Orbitron] text-lg font-bold tracking-wider glow-accent">Code-K</span>
              <span className="text-xs text-ex-dim font-mono">代码交易所</span>
            </Link>
            <div className="h-5 w-px bg-ex-border" />
            <Link
              to="/market"
              className={`text-sm no-underline hover:text-ex-heading transition-colors ${
                location.pathname === '/market' ? 'text-ex-accent' : 'text-ex-text'
              }`}
            >
              行情
            </Link>
            <Link
              to="/dashboard"
              className={`text-sm no-underline hover:text-ex-heading transition-colors ${
                location.pathname === '/dashboard' ? 'text-ex-accent' : 'text-ex-text'
              }`}
            >
              大盘
            </Link>
          </div>

          <div className="flex items-center gap-6 text-xs font-mono">
            {/* WebSocket 状态 */}
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-ex-green' : 'bg-ex-red'}`} />
              <span className="text-ex-dim">{wsConnected ? '已连接' : '已断开'}</span>
              {!wsConnected && hasBackendRepo && (
                <button
                  onClick={() => reconnect()}
                  className="ml-1 flex items-center gap-1 px-2 py-1 rounded border border-ex-red/30
                    text-ex-red hover:text-ex-accent hover:border-ex-accent/40 transition-colors cursor-pointer"
                  title="重新连接 WebSocket"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                  重新连接
                </button>
              )}
            </div>

            {/* 计数区：移动端折叠防溢出 */}
            <div className="hidden md:flex items-center gap-6">
              <div className="h-5 w-px bg-ex-border" />

              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-ex-green animate-pulse" />
                <span className="text-ex-dim">上市中</span>
                <span className="text-ex-heading">{activeStocks}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-ex-gold" />
                <span className="text-ex-dim">新上市</span>
                <span className="text-ex-heading">{ipoStocks}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-ex-dim" />
                <span className="text-ex-dim">已退市</span>
                <span className="text-ex-heading">{delistedStocks}</span>
              </div>
              {repoName && (
                <>
                  <div className="h-5 w-px bg-ex-border" />
                  <span className="text-ex-accent truncate max-w-[200px]">{repoName}</span>
                </>
              )}
            </div>
          </div>
        </nav>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      {/* Scanline overlay */}
      <div className="scanlines" />

      {/* Shortcuts Help */}
      <ShortcutsHelp />
    </div>
  )
}
