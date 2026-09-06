import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

interface ShortcutHandlers {
  onEscape?: () => void
  onSearch?: () => void
}

/** vim 风格 'g' 前缀键的超时窗口（毫秒） */
const G_PREFIX_TIMEOUT = 800

export function useShortcuts(handlers: ShortcutHandlers) {
  const navigate = useNavigate()

  // handlers 用 ref 保存：调用方每次渲染传入新对象也不会导致全局 keydown 反复解绑重绑
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  const gPendingRef = useRef(false)
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框内的快捷键
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        // 只处理 Escape 键
        if (e.key === 'Escape') {
          handlersRef.current.onEscape?.()
        }
        return
      }

      // Ctrl/Cmd + K: 搜索
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        handlersRef.current.onSearch?.()
        return
      }

      // Escape: 返回/关闭
      if (e.key === 'Escape') {
        e.preventDefault()
        handlersRef.current.onEscape?.()
        return
      }

      // 带修饰键的其它按键不处理
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // vim 风格序列：g h → 首页，g m → 行情页
      if (e.key === 'g') {
        gPendingRef.current = true
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
        gTimerRef.current = setTimeout(() => {
          gPendingRef.current = false
          gTimerRef.current = null
        }, G_PREFIX_TIMEOUT)
        return
      }

      if (gPendingRef.current && (e.key === 'h' || e.key === 'm')) {
        gPendingRef.current = false
        if (gTimerRef.current) {
          clearTimeout(gTimerRef.current)
          gTimerRef.current = null
        }
        e.preventDefault()
        navigate(e.key === 'h' ? '/' : '/market')
        return
      }

      // 其它按键取消 'g' 前缀状态
      gPendingRef.current = false
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (gTimerRef.current) {
        clearTimeout(gTimerRef.current)
        gTimerRef.current = null
      }
    }
  }, [navigate])
}

// 快捷键帮助信息（与实际可用的快捷键保持一致）
export const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: '搜索' },
  { keys: ['G', 'H'], description: '返回首页' },
  { keys: ['G', 'M'], description: '行情页' },
  { keys: ['Esc'], description: '返回/关闭' },
  { keys: ['?'], description: '快捷键帮助' },
]
