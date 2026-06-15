/**
 * 轻量级结构化日志器 — 不引入外部依赖
 *
 * 特性：
 *  - 带 tag 的分级日志（debug / info / warn / error）
 *  - 可通过环境变量 CODEK_LOG_LEVEL 控制级别（默认 info）
 *  - 内存环形缓冲（最近 500 条），便于运行时排查；可选落盘
 *  - 提供 createTaggedLogger(tag) 工厂，复用同一缓冲与配置
 *
 * 设计目标：替代 server 中散落的 ad-hoc console.log('[Tag]')，
 *          让 numstat 解析、commit 识别等过程可追溯。
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

const ENV_LEVEL = (process.env.CODEK_LOG_LEVEL || 'info').toLowerCase()
const CURRENT_LEVEL = LEVELS[ENV_LEVEL] ?? LEVELS.info

const BUFFER_MAX = 500
const ringBuffer = []

/**
 * 把一条记录写入环形缓冲
 * @param {{level: string, tag: string, message: string, data?: unknown, ts: number}} entry
 */
function pushBuffer(entry) {
  ringBuffer.push(entry)
  if (ringBuffer.length > BUFFER_MAX) ringBuffer.shift()
}

/**
 * 获取最近 N 条日志记录（默认全部）
 * 用于排查问题时的运行时自省
 * @param {number} [limit]
 * @returns {Array<{level: string, tag: string, message: string, data?: unknown, ts: string}>}
 */
export function getRecentLogs(limit) {
  const slice = typeof limit === 'number' ? ringBuffer.slice(-limit) : ringBuffer.slice()
  return slice.map((e) => ({ ...e, ts: new Date(e.ts).toISOString() }))
}

/**
 * 创建带固定 tag 的日志器
 * @param {string} tag - 如 'Parser' / 'Watcher' / 'Cache'
 * @returns {{debug: (msg: string, data?: unknown) => void, info: (...args: unknown[]) => void, warn: (...args: unknown[]) => void, error: (...args: unknown[]) => void}}
 */
export function createTaggedLogger(tag) {
  const emit = (level, message, data) => {
    const ts = Date.now()
    const entry = { level, tag, message, ts }
    if (data !== undefined) entry.data = data
    pushBuffer(entry)

    if (LEVELS[level] < CURRENT_LEVEL) return

    const prefix = `[${tag}]`
    if (level === 'error') {
      console.error(prefix, message, data !== undefined ? data : '')
    } else if (level === 'warn') {
      console.warn(prefix, message, data !== undefined ? data : '')
    } else {
      console.log(prefix, message, data !== undefined ? data : '')
    }
  }

  return {
    /** 详细调试信息，仅在 CODEK_LOG_LEVEL=debug 时输出 */
    debug: (message, data) => emit('debug', message, data),
    /** 常规信息 */
    info: (message, data) => emit('info', message, data),
    /** 警告 */
    warn: (message, data) => emit('warn', message, data),
    /** 错误 */
    error: (message, data) => emit('error', message, data),
  }
}

/** 默认导出：不带 tag 的通用日志器 */
export default {
  debug: (message, data) => createTaggedLogger('App').debug(message, data),
  info: (message, data) => createTaggedLogger('App').info(message, data),
  warn: (message, data) => createTaggedLogger('App').warn(message, data),
  error: (message, data) => createTaggedLogger('App').error(message, data),
}
