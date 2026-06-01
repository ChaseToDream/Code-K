import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useRepo } from '../hooks/useRepo'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const isHome = location.pathname === '/'
  const { activeRepo, wsConnected } = useRepo()

  const stocks = activeRepo?.stocks || []
  const repoName = activeRepo?.name || ''

  const activeStocks = stocks.filter(s => s.status === 'active').length
  const ipoStocks = stocks.filter(s => s.status === 'ipo').length
  const delistedStocks = stocks.filter(s => s.status === 'delisted').length

  return (
    <div className="h-full flex flex-col">
      {/* Ticker Tape Header */}
      {!isHome && stocks.length > 0 && (
        <div className="bg-ex-surface border-b border-ex-border overflow-hidden h-8 flex items-center shrink-0">
          <div className="ticker-tape flex whitespace-nowrap gap-8 text-xs font-mono">
            {[...stocks, ...stocks].map((stock, i) => {
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
              <span className="font-[Orbitron] text-lg font-bold tracking-wider glow-accent">CODEX</span>
              <span className="text-xs text-ex-dim font-mono">代码交易所</span>
            </Link>
            <div className="h-5 w-px bg-ex-border" />
            <Link
              to="/market"
              className="text-sm text-ex-text no-underline hover:text-ex-heading transition-colors"
            >
              行情
            </Link>
          </div>

          <div className="flex items-center gap-6 text-xs font-mono">
            {/* WebSocket 状态 */}
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-ex-green' : 'bg-ex-red'}`} />
              <span className="text-ex-dim">{wsConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
            </div>

            <div className="h-5 w-px bg-ex-border" />

            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-ex-green animate-pulse" />
              <span className="text-ex-dim">ACTIVE</span>
              <span className="text-ex-heading">{activeStocks}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-ex-gold" />
              <span className="text-ex-dim">IPO</span>
              <span className="text-ex-heading">{ipoStocks}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-ex-dim" />
              <span className="text-ex-dim">DELISTED</span>
              <span className="text-ex-heading">{delistedStocks}</span>
            </div>
            {repoName && (
              <>
                <div className="h-5 w-px bg-ex-border" />
                <span className="text-ex-accent truncate max-w-[200px]">{repoName}</span>
              </>
            )}
          </div>
        </nav>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      {/* Scanline overlay */}
      <div className="scanlines" />
    </div>
  )
}
