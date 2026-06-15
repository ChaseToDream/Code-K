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
 * 影线（上下影线）样式配置 —— 与 K 线主体配色一致，使用实色确保影线清晰可辨。
 */
export const WICK_STYLE = {
  upColor: '#00e676',
  downColor: '#ff1744',
} as const
