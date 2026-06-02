import { useState, useCallback } from 'react'
import { SHORTCUTS } from '../hooks/useShortcuts'

export default function ShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false)

  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev)
  }, [])

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [])

  if (!isOpen) {
    return (
      <button
        onClick={handleToggle}
        className="fixed bottom-4 right-4 w-10 h-10 bg-ex-surface border border-ex-border rounded-full
          flex items-center justify-center text-ex-dim hover:text-ex-text transition-colors cursor-pointer z-50"
        title="快捷键帮助 (?)"
      >
        <span className="text-sm font-mono">?</span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-ex-surface border border-ex-border rounded-lg p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-mono font-semibold text-ex-heading">快捷键</h2>
          <button
            onClick={handleClose}
            className="text-ex-dim hover:text-ex-red transition-colors cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          {SHORTCUTS.map((shortcut, index) => (
            <div key={index} className="flex items-center justify-between py-2 border-b border-ex-border/50 last:border-0">
              <span className="text-sm text-ex-text">{shortcut.description}</span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key, i) => (
                  <span key={i}>
                    <kbd className="px-2 py-1 text-xs font-mono bg-ex-panel border border-ex-border rounded">
                      {key}
                    </kbd>
                    {i < shortcut.keys.length - 1 && (
                      <span className="text-ex-dim mx-1">+</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-ex-border">
          <p className="text-xs text-ex-dim text-center">
            按 <kbd className="px-1 py-0.5 text-xs font-mono bg-ex-panel border border-ex-border rounded">Esc</kbd> 关闭
          </p>
        </div>
      </div>
    </div>
  )
}
