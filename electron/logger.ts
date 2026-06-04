import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'

/**
 * 日志级别
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * 日志条目
 */
interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  source?: string
}

/**
 * 日志管理器 - 集中管理 Electron 应用日志
 */
class Logger {
  private logDir: string
  private logFile: string
  private maxLogSize: number = 5 * 1024 * 1024 // 5MB
  private logQueue: LogEntry[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.logDir = join(app.getPath('userData'), 'logs')
    this.logFile = join(this.logDir, 'app.log')
    this.ensureLogDir()
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  /**
   * 格式化日志条目
   */
  private format(entry: LogEntry): string {
    const source = entry.source ? ` [${entry.source}]` : ''
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}]${source} ${entry.message}\n`
  }

  /**
   * 写入日志到文件
   */
  private flush() {
    if (this.logQueue.length === 0) return

    try {
      // 检查日志文件大小
      if (existsSync(this.logFile)) {
        const stats = statSync(this.logFile)
        if (stats.size > this.maxLogSize) {
          // 轮转日志
          const backupFile = join(this.logDir, `app-${Date.now()}.log`)
          renameSync(this.logFile, backupFile)
        }
      }

      const content = this.logQueue.map(e => this.format(e)).join('')
      appendFileSync(this.logFile, content, 'utf-8')
      this.logQueue = []
    } catch (err) {
      console.error('Failed to write log:', err)
    }
  }

  /**
   * 延迟批量写入
   */
  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flush()
      this.flushTimer = null
    }, 1000)
  }

  /**
   * 添加日志条目
   */
  private log(level: LogLevel, message: string, source?: string) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      source,
    }

    // 同时输出到控制台
    const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    consoleMethod(`[${level.toUpperCase()}]${source ? ` [${source}]` : ''} ${message}`)

    this.logQueue.push(entry)
    this.scheduleFlush()
  }

  debug(message: string, source?: string) {
    if (process.env.NODE_ENV === 'development') {
      this.log('debug', message, source)
    }
  }

  info(message: string, source?: string) {
    this.log('info', message, source)
  }

  warn(message: string, source?: string) {
    this.log('warn', message, source)
  }

  error(message: string, source?: string) {
    this.log('error', message, source)
  }

  /**
   * 获取日志文件路径
   */
  getLogPath(): string {
    return this.logFile
  }

  /**
   * 获取最近的日志内容
   */
  getRecentLogs(lines: number = 100): string {
    try {
      if (!existsSync(this.logFile)) return ''
      const content = readFileSync(this.logFile, 'utf-8')
      const allLines = content.split('\n').filter(Boolean)
      return allLines.slice(-lines).join('\n')
    } catch {
      return ''
    }
  }

  /**
   * 清理旧日志文件
   */
  cleanupOldLogs(maxAgeDays: number = 7) {
    try {
      const files = readdirSync(this.logDir)
      const now = Date.now()
      const maxAge = maxAgeDays * 24 * 60 * 60 * 1000

      for (const file of files) {
        if (file === 'app.log') continue
        const filePath = join(this.logDir, file)
        const stats = statSync(filePath)
        if (now - stats.mtime.getTime() > maxAge) {
          unlinkSync(filePath)
          this.info(`Cleaned up old log: ${file}`, 'Logger')
        }
      }
    } catch (err) {
      this.error(`Failed to cleanup logs: ${err}`, 'Logger')
    }
  }
}

// 单例导出
export const logger = new Logger()
