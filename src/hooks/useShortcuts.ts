import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

interface ShortcutHandlers {
  onEscape?: () => void
  onSearch?: () => void
  onHome?: () => void
  onMarket?: () => void
  onToggleSidebar?: () => void
}

export function useShortcuts(handlers: ShortcutHandlers) {
  const navigate = useNavigate()

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // 忽略输入框内的快捷键
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      // 只处理 Escape 键
      if (e.key === 'Escape' && handlers.onEscape) {
        handlers.onEscape()
      }
      return
    }

    // Ctrl/Cmd + K: 搜索
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      handlers.onSearch?.()
      return
    }

    // Escape: 返回/关闭
    if (e.key === 'Escape' && handlers.onEscape) {
      e.preventDefault()
      handlers.onEscape()
      return
    }

    // Ctrl/Cmd + H: 首页
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault()
      navigate('/')
      return
    }

    // Ctrl/Cmd + M: 行情页
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault()
      navigate('/market')
      return
    }

    // Ctrl/Cmd + B: 切换侧边栏
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      handlers.onToggleSidebar?.()
      return
    }
  }, [handlers, navigate])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

// 快捷键帮助信息
export const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: '搜索' },
  { keys: ['Ctrl', 'H'], description: '返回首页' },
  { keys: ['Ctrl', 'M'], description: '行情页' },
  { keys: ['Ctrl', 'B'], description: '切换侧边栏' },
  { keys: ['Esc'], description: '返回/关闭' },
]
