import { useMemo, useState } from 'react'

interface DiffViewerProps {
  fileName: string
  commitHash: string        // 短 hash
  oldContent: string | null // null = 该侧不存在（新增/删除文件）
  newContent: string | null
  additions: number         // 真实增行数（后端 numstat 或 candle 提供）
  deletions: number
  isBinary?: boolean
  onClose: () => void
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  oldLineNum: number | null
  newLineNum: number | null
  content: string
}

interface DiffResult {
  lines: DiffLine[]
  /** 文件过大时退化为头部/尾部对齐截断（中间不做 LCS） */
  degraded: boolean
}

/** 两侧行数均超过该值时退化为截断对比 */
const MAX_FULL_DIFF_LINES = 5000
/** LCS 工作量上限（midOld × midNew），超出同样退化，防止极端输入卡死 */
const MAX_DIFF_CELLS = 25_000_000
/** 渲染保护：diff 结果最多渲染的行数 */
const RENDER_LIMIT = 3000

/**
 * 计算 x 全文与 y 各前缀的 LCS 长度（Hirschberg 用，滚动两行，空间 O(m)）。
 * 返回 row，row[j] = LCS(x, y[0..j)) 的长度。
 */
function lcsRow(x: string[], y: string[]): Uint32Array {
  const m = y.length
  let prev = new Uint32Array(m + 1)
  let curr = new Uint32Array(m + 1)
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    for (let j = 1; j <= m; j++) {
      if (xi === y[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = prev[j] > curr[j - 1] ? prev[j] : curr[j - 1]
      }
    }
    const tmp = prev
    prev = curr
    curr = tmp
    curr.fill(0)
  }
  return prev
}

/**
 * Hirschberg 线性空间 LCS diff：对 a 取中点，沿 b 找最优切分，分治递归。
 * aOffset/bOffset 为切片在原始文件中的 0 基起始行号，用于还原行号。
 */
function splitDiff(a: string[], b: string[], aOffset: number, bOffset: number, out: DiffLine[]): void {
  const n = a.length
  const m = b.length

  if (n === 0) {
    for (let j = 0; j < m; j++) {
      out.push({ type: 'added', oldLineNum: null, newLineNum: bOffset + j + 1, content: b[j] })
    }
    return
  }
  if (m === 0) {
    for (let i = 0; i < n; i++) {
      out.push({ type: 'removed', oldLineNum: aOffset + i + 1, newLineNum: null, content: a[i] })
    }
    return
  }
  if (n === 1) {
    const idx = b.indexOf(a[0])
    if (idx === -1) {
      out.push({ type: 'removed', oldLineNum: aOffset + 1, newLineNum: null, content: a[0] })
      for (let j = 0; j < m; j++) {
        out.push({ type: 'added', oldLineNum: null, newLineNum: bOffset + j + 1, content: b[j] })
      }
    } else {
      for (let j = 0; j < idx; j++) {
        out.push({ type: 'added', oldLineNum: null, newLineNum: bOffset + j + 1, content: b[j] })
      }
      out.push({ type: 'unchanged', oldLineNum: aOffset + 1, newLineNum: bOffset + idx + 1, content: a[0] })
      for (let j = idx + 1; j < m; j++) {
        out.push({ type: 'added', oldLineNum: null, newLineNum: bOffset + j + 1, content: b[j] })
      }
    }
    return
  }

  const mid = Math.floor(n / 2)
  const left = lcsRow(a.slice(0, mid), b)
  const right = lcsRow(a.slice(mid).reverse(), [...b].reverse())

  let bestK = 0
  let best = -1
  for (let k = 0; k <= m; k++) {
    const value = left[k] + right[m - k]
    if (value > best) {
      best = value
      bestK = k
    }
  }

  splitDiff(a.slice(0, mid), b.slice(0, bestK), aOffset, bOffset, out)
  splitDiff(a.slice(mid), b.slice(bestK), aOffset + mid, bOffset + bestK, out)
}

/**
 * 行级 diff：先剥离公共头尾，中段用 Hirschberg LCS 对齐。
 * 文件过大（两侧各超 MAX_FULL_DIFF_LINES 或中段工作量超限）时退化：
 * 公共头尾保持对齐，中段直接按「全部删除 + 全部新增」输出。
 */
function computeDiff(oldText: string | null, newText: string | null): DiffResult {
  const oldLines = oldText === null ? [] : oldText.split('\n')
  const newLines = newText === null ? [] : newText.split('\n')

  // 公共前缀
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++
  }
  // 公共后缀
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--
    newEnd--
  }

  const midOld = oldEnd - start
  const midNew = newEnd - start
  const degraded =
    (oldLines.length > MAX_FULL_DIFF_LINES && newLines.length > MAX_FULL_DIFF_LINES) ||
    midOld * midNew > MAX_DIFF_CELLS

  const lines: DiffLine[] = []

  for (let i = 0; i < start; i++) {
    lines.push({ type: 'unchanged', oldLineNum: i + 1, newLineNum: i + 1, content: oldLines[i] })
  }

  if (degraded) {
    for (let i = start; i < oldEnd; i++) {
      lines.push({ type: 'removed', oldLineNum: i + 1, newLineNum: null, content: oldLines[i] })
    }
    for (let j = start; j < newEnd; j++) {
      lines.push({ type: 'added', oldLineNum: null, newLineNum: j + 1, content: newLines[j] })
    }
  } else {
    splitDiff(oldLines.slice(start, oldEnd), newLines.slice(start, newEnd), start, start, lines)
  }

  for (let i = oldEnd; i < oldLines.length; i++) {
    lines.push({
      type: 'unchanged',
      oldLineNum: i + 1,
      newLineNum: newEnd + (i - oldEnd) + 1,
      content: oldLines[i],
    })
  }

  return { lines, degraded }
}

export default function DiffViewer({ fileName, commitHash, oldContent, newContent, additions, deletions, isBinary = false, onClose }: DiffViewerProps) {
  const [showUnchanged, setShowUnchanged] = useState(true)

  const { lines: diffLines, degraded } = useMemo(
    () => (isBinary ? { lines: [], degraded: false } : computeDiff(oldContent, newContent)),
    [oldContent, newContent, isBinary]
  )

  const filteredLines = useMemo(() => {
    if (showUnchanged) return diffLines
    return diffLines.filter(line => line.type !== 'unchanged')
  }, [diffLines, showUnchanged])

  const truncated = filteredLines.length > RENDER_LIMIT
  const renderLines = truncated ? filteredLines.slice(0, RENDER_LIMIT) : filteredLines

  const getLineClass = (type: DiffLine['type']) => {
    switch (type) {
      case 'added':
        return 'bg-ex-green/10 text-ex-green'
      case 'removed':
        return 'bg-ex-red/10 text-ex-red'
      default:
        return 'text-ex-text'
    }
  }

  const getLinePrefix = (type: DiffLine['type']) => {
    switch (type) {
      case 'added':
        return '+'
      case 'removed':
        return '-'
      default:
        return ' '
    }
  }

  return (
    <div className="bg-ex-surface border border-ex-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-ex-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <span className="font-mono text-sm text-ex-heading font-semibold truncate">{fileName}</span>
          <span className="text-xs font-mono text-ex-dim">@{commitHash}</span>
          {oldContent === null && (
            <span className="text-xs font-mono text-ex-gold">旧版本（不存在）</span>
          )}
          {newContent === null && (
            <span className="text-xs font-mono text-ex-gold">新版本（不存在）</span>
          )}
          <span className="text-xs font-mono text-ex-green">+{additions}</span>
          <span className="text-xs font-mono text-ex-red">-{deletions}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isBinary && (
            <button
              onClick={() => setShowUnchanged(!showUnchanged)}
              className="px-3 py-1 text-xs font-mono bg-ex-panel border border-ex-border rounded
                text-ex-dim hover:text-ex-text transition-colors cursor-pointer"
            >
              {showUnchanged ? '隐藏' : '显示'}未修改行
            </button>
          )}
          <button
            onClick={onClose}
            className="text-ex-dim hover:text-ex-red transition-colors p-1 cursor-pointer"
            aria-label="关闭对比"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Diff Content */}
      {isBinary ? (
        <div className="p-8 text-center text-ex-dim text-sm font-mono">二进制文件无法对比</div>
      ) : (
        <div className="max-h-96 overflow-y-auto font-mono text-xs">
          {degraded && (
            <div className="px-4 py-2 text-ex-gold bg-ex-gold/5 border-b border-ex-border/50">
              文件过大，仅显示部分对比
            </div>
          )}
          {renderLines.length === 0 ? (
            <div className="p-4 text-center text-ex-dim">无差异内容</div>
          ) : (
            renderLines.map((line, idx) => (
              <div
                key={idx}
                className={`flex ${getLineClass(line.type)} hover:bg-ex-panel/50 transition-colors`}
              >
                {/* Line Numbers */}
                <div className="flex shrink-0">
                  <span className="w-12 text-right pr-2 text-ex-dim border-r border-ex-border/50">
                    {line.oldLineNum || ''}
                  </span>
                  <span className="w-12 text-right pr-2 text-ex-dim border-r border-ex-border/50">
                    {line.newLineNum || ''}
                  </span>
                </div>

                {/* Prefix */}
                <span className="w-6 text-center shrink-0">
                  {getLinePrefix(line.type)}
                </span>

                {/* Content */}
                <span className="flex-1 whitespace-pre overflow-x-auto py-0.5 px-1">
                  {line.content}
                </span>
              </div>
            ))
          )}
          {truncated && (
            <div className="px-4 py-2 text-ex-gold bg-ex-gold/5 border-t border-ex-border/50">
              内容过长，仅显示前 {RENDER_LIMIT} 行
            </div>
          )}
        </div>
      )}
    </div>
  )
}
