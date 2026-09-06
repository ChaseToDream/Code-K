import type { MarketStats as MarketStatsType, SectorInfo } from '../hooks/useMarketIndex'

interface MarketStatsProps {
  stats: MarketStatsType
  sectors: SectorInfo[]
}

/**
 * 根据涨跌比例计算市场情绪（等宽字体文字徽章，与终端风格一致）
 */
function getSentiment(upCount: number, downCount: number): { label: string; badge: string; badgeClass: string; labelColor: string } {
  const total = upCount + downCount
  if (total === 0) return { label: '平静', badge: '[CALM]', badgeClass: 'bg-ex-dim/15 text-ex-dim border-ex-dim/30', labelColor: 'text-ex-dim' }

  const upRatio = upCount / total
  if (upRatio > 0.7) return { label: '狂热', badge: '[STRONG]', badgeClass: 'bg-ex-green/15 text-ex-green border-ex-green/30', labelColor: 'text-ex-green' }
  if (upRatio > 0.5) return { label: '乐观', badge: '[BULLISH]', badgeClass: 'bg-ex-green/15 text-ex-green border-ex-green/30', labelColor: 'text-ex-green' }
  if (upRatio > 0.3) return { label: '谨慎', badge: '[NEUTRAL]', badgeClass: 'bg-ex-gold/15 text-ex-gold border-ex-gold/30', labelColor: 'text-ex-gold' }
  return { label: '恐慌', badge: '[PANIC]', badgeClass: 'bg-ex-red/15 text-ex-red border-ex-red/30', labelColor: 'text-ex-red' }
}

/**
 * 计算板块色块宽度比例
 */
function getSectorBarWidth(totalLines: number, maxLines: number): string {
  if (maxLines === 0) return '0%'
  return `${Math.max(4, (totalLines / maxLines) * 100)}%`
}

/**
 * 市场统计面板组件：涨跌分布、板块热力图、市场情绪、成交统计
 */
export default function MarketStats({ stats, sectors }: MarketStatsProps) {
  const sentiment = getSentiment(stats.upCount, stats.downCount)
  const total = stats.upCount + stats.flatCount + stats.downCount
  const maxSectorLines = sectors.length > 0 ? Math.max(...sectors.map(s => s.totalLines)) : 0

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* 涨跌分布 */}
      <div className="bg-ex-surface border border-ex-border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-mono text-ex-dim uppercase tracking-wider">涨跌分布</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-ex-dim w-8">涨</span>
            <div className="flex-1 h-4 bg-ex-surface rounded overflow-hidden border border-ex-border">
              <div
                className="h-full bg-ex-green/60 rounded transition-all"
                style={{ width: total > 0 ? `${(stats.upCount / total) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-xs font-mono text-ex-green w-6 text-right">{stats.upCount}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-ex-dim w-8">平</span>
            <div className="flex-1 h-4 bg-ex-surface rounded overflow-hidden border border-ex-border">
              <div
                className="h-full bg-ex-dim/40 rounded transition-all"
                style={{ width: total > 0 ? `${(stats.flatCount / total) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-xs font-mono text-ex-dim w-6 text-right">{stats.flatCount}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-ex-dim w-8">跌</span>
            <div className="flex-1 h-4 bg-ex-surface rounded overflow-hidden border border-ex-border">
              <div
                className="h-full bg-ex-red/60 rounded transition-all"
                style={{ width: total > 0 ? `${(stats.downCount / total) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-xs font-mono text-ex-red w-6 text-right">{stats.downCount}</span>
          </div>
        </div>
        <div className="pt-2 border-t border-ex-border">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-ex-dim">总计</span>
            <span className="text-ex-heading">{total}</span>
          </div>
        </div>
      </div>

      {/* 板块热力图 */}
      <div className="bg-ex-surface border border-ex-border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-mono text-ex-dim uppercase tracking-wider">板块热力</h3>
        <div className="space-y-1.5 max-h-36 overflow-y-auto">
          {sectors.length === 0 ? (
            <span className="text-xs font-mono text-ex-dim">暂无板块数据</span>
          ) : (
            sectors.slice(0, 8).map((sector) => (
              <div key={sector.name} className="flex items-center gap-2">
                <span className="text-xs font-mono text-ex-dim w-20 truncate" title={sector.name}>{sector.name}</span>
                <div className="flex-1 h-3 bg-ex-surface rounded overflow-hidden border border-ex-border">
                  <div
                    className={`h-full rounded transition-all ${
                      sector.avgChangePercent >= 0 ? 'bg-ex-green/50' : 'bg-ex-red/50'
                    }`}
                    style={{ width: getSectorBarWidth(sector.totalLines, maxSectorLines) }}
                  />
                </div>
                <span className={`text-xs font-mono w-12 text-right ${
                  sector.avgChangePercent >= 0 ? 'text-ex-green' : 'text-ex-red'
                }`}>
                  {sector.avgChangePercent >= 0 ? '+' : ''}{sector.avgChangePercent.toFixed(1)}%
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 市场情绪 + 成交统计 */}
      <div className="bg-ex-surface border border-ex-border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-mono text-ex-dim uppercase tracking-wider">市场情绪</h3>
        <div className="flex items-center gap-3">
          <span className={`px-2 py-0.5 text-sm font-mono font-bold rounded border ${sentiment.badgeClass}`}>
            {sentiment.badge}
          </span>
          <span className={`text-lg font-mono font-semibold ${sentiment.labelColor}`}>{sentiment.label}</span>
        </div>

        <div className="pt-2 border-t border-ex-border space-y-2">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-ex-dim">总提交数</span>
            <span className="text-ex-heading">{stats.totalCommits.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-ex-dim">最活跃作者</span>
            <span className="text-ex-accent truncate max-w-24">{stats.topAuthor}</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-ex-dim">平均变更行数</span>
            <span className="text-ex-heading">{stats.avgVolumePerCommit.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
