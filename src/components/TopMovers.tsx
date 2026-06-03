import { useNavigate } from 'react-router-dom'
import type { TopMover } from '../hooks/useMarketIndex'

interface TopMoversProps {
  gainers: TopMover[]
  losers: TopMover[]
  volume: TopMover[]
}

interface MoverListProps {
  title: string
  items: TopMover[]
  type: 'change' | 'volume'
}

/**
 * 单个排行榜列表
 */
function MoverList({ title, items, type }: MoverListProps) {
  const navigate = useNavigate()

  const handleClick = (path: string) => {
    navigate(`/stock/${encodeURIComponent(path)}`)
  }

  return (
    <div className="bg-ex-surface border border-ex-border rounded-lg p-4 space-y-3">
      <h3 className="text-xs font-mono text-ex-dim uppercase tracking-wider">{title}</h3>
      <div className="space-y-1">
        {items.length === 0 ? (
          <span className="text-xs font-mono text-ex-dim">暂无数据</span>
        ) : (
          items.map((item, index) => (
            <button
              key={item.path}
              onClick={() => handleClick(item.path)}
              className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-ex-border/30 transition-colors text-left cursor-pointer"
            >
              <span className="text-xs font-mono text-ex-dim w-4">{index + 1}</span>
              <span className="text-xs font-mono text-ex-heading truncate flex-1">{item.ticker}</span>
              {type === 'change' ? (
                <span className={`text-xs font-mono ${item.changePercent >= 0 ? 'text-ex-green' : 'text-ex-red'}`}>
                  {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(1)}%
                </span>
              ) : (
                <span className="text-xs font-mono text-ex-accent">
                  {item.volume.toLocaleString()}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

/**
 * 热门排行组件：涨幅榜、跌幅榜、成交量榜
 */
export default function TopMovers({ gainers, losers, volume }: TopMoversProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <MoverList title="涨幅榜 Top 5" items={gainers} type="change" />
      <MoverList title="跌幅榜 Top 5" items={losers} type="change" />
      <MoverList title="成交量榜 Top 5" items={volume} type="volume" />
    </div>
  )
}
