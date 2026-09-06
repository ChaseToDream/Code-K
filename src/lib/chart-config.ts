/**
 * 图表共享配置 —— KlineChart 与 MarketIndexChart 共用的常量
 *
 * 抽离为独立模块，避免在组件文件中导出非组件值（react-refresh 要求组件文件只导出组件）。
 */

/**
 * 固定的 K 线宽度（相邻蜡烛中心间距，像素）。
 * 固定后不再随容器宽度重算：数据少时不被拉伸，屏幕宽度变化时单根 K 线宽度保持一致。
 * 滚轮缩放仍可临时改变可见比例（lightweight-charts 内置），但不回写此默认值。
 */
export const FIXED_BAR_SPACING = 12

/**
 * 图表涨跌色值 —— 与 index.css 的 ex-green / ex-red token 保持一致。
 * 所有图表组件（KlineChart / MarketIndexChart / SparklineChart）统一引用此处。
 */
export const CHART_COLORS = {
  up: '#00e676',
  down: '#ff1744',
  /** 成交量柱（20% 透明度） */
  upVolume: 'rgba(0, 230, 118, 0.2)',
  downVolume: 'rgba(255, 23, 68, 0.2)',
  /** 迷你走势图面积填充（15% 透明度） */
  upArea: 'rgba(0, 230, 118, 0.15)',
  downArea: 'rgba(255, 23, 68, 0.15)',
} as const

/**
 * 影线（上下影线）样式配置 —— 与 K 线主体配色一致，使用实色确保影线清晰可辨。
 */
export const WICK_STYLE = {
  upColor: CHART_COLORS.up,
  downColor: CHART_COLORS.down,
} as const
