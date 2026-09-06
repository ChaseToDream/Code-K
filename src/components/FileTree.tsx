import { useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { FileStock } from '../lib/types'

interface FileTreeProps {
  stocks: FileStock[]
  /** 当前查看的文件路径，对应行高亮 */
  activePath?: string
}

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  stock?: FileStock
  children: TreeNode[]
}

function buildTree(stocks: FileStock[]): TreeNode[] {
  const root: TreeNode[] = []
  const folderMap = new Map<string, TreeNode>()

  // Sort stocks by path
  const sortedStocks = [...stocks].sort((a, b) => a.path.localeCompare(b.path))

  for (const stock of sortedStocks) {
    const parts = stock.path.split('/')
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const currentPath = parts.slice(0, i + 1).join('/')
      const isFile = i === parts.length - 1

      if (isFile) {
        // Add file node
        currentLevel.push({
          name: part,
          path: currentPath,
          type: 'file',
          stock,
          children: [],
        })
      } else {
        // Find or create folder
        let folder = folderMap.get(currentPath)
        if (!folder) {
          folder = {
            name: part,
            path: currentPath,
            type: 'folder',
            children: [],
          }
          folderMap.set(currentPath, folder)
          currentLevel.push(folder)
        }
        currentLevel = folder.children
      }
    }
  }

  return root
}

function FolderNode({
  node,
  depth,
  expandedFolders,
  activePath,
  onToggle,
}: {
  node: TreeNode
  depth: number
  expandedFolders: Set<string>
  activePath?: string
  onToggle: (path: string) => void
}) {
  const isExpanded = expandedFolders.has(node.path)
  const hasChildren = node.children.length > 0

  return (
    <div>
      <button
        type="button"
        aria-expanded={isExpanded}
        className="w-full text-left flex items-center gap-1 py-1 px-2 hover:bg-ex-panel/50 cursor-pointer transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onToggle(node.path)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-ex-dim transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`shrink-0 ${isExpanded ? 'text-ex-accent' : 'text-ex-gold'}`}
        >
          {isExpanded ? (
            // 展开的文件夹
            <path d="M3.75 9.78c.112-.018.227-.028.344-.028h15.812c.117 0 .232.01.344.028m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.78" />
          ) : (
            // 折叠的文件夹
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          )}
        </svg>
        <span className="text-sm font-mono text-ex-heading truncate">{node.name}</span>
        <span className="text-xs text-ex-dim ml-auto">{node.children.length}</span>
      </button>
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNodeComponent
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              activePath={activePath}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileNode({
  node,
  depth,
  activePath,
}: {
  node: TreeNode
  depth: number
  activePath?: string
}) {
  const stock = node.stock
  if (!stock) return null

  const isUp = stock.changePercent >= 0
  const isActive = activePath === node.path

  return (
    <Link
      to={`/stock/${encodeURIComponent(stock.path)}`}
      aria-current={isActive ? 'page' : undefined}
      className={`flex items-center gap-2 py-1 px-2 transition-colors no-underline
        ${isActive ? 'bg-ex-accent/10' : 'hover:bg-ex-panel/50'}`}
      style={{ paddingLeft: `${depth * 16 + 24}px` }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-ex-dim shrink-0"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="text-sm font-mono text-ex-heading truncate flex-1">{node.name}</span>
      <span className="text-xs font-mono text-ex-dim">{stock.currentLines}</span>
      <span className={`text-xs font-mono ${isUp ? 'text-ex-green' : 'text-ex-red'}`}>
        {isUp ? '+' : ''}{stock.changePercent.toFixed(1)}%
      </span>
    </Link>
  )
}

function TreeNodeComponent({
  node,
  depth,
  expandedFolders,
  activePath,
  onToggle,
}: {
  node: TreeNode
  depth: number
  expandedFolders: Set<string>
  activePath?: string
  onToggle: (path: string) => void
}) {
  if (node.type === 'folder') {
    return (
      <FolderNode
        node={node}
        depth={depth}
        expandedFolders={expandedFolders}
        activePath={activePath}
        onToggle={onToggle}
      />
    )
  }
  return <FileNode node={node} depth={depth} activePath={activePath} />
}

export default function FileTree({ stocks, activePath }: FileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildTree(stocks), [stocks])

  const handleToggle = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleExpandAll = useCallback(() => {
    const allFolders = new Set<string>()
    const collectFolders = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          allFolders.add(node.path)
          collectFolders(node.children)
        }
      }
    }
    collectFolders(tree)
    setExpandedFolders(allFolders)
  }, [tree])

  const handleCollapseAll = useCallback(() => {
    setExpandedFolders(new Set())
  }, [])

  return (
    <div className="bg-ex-surface border border-ex-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2 border-b border-ex-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-ex-accent"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-xs font-mono text-ex-heading">文件树</span>
          <span className="text-xs font-mono text-ex-dim">({stocks.length} 文件)</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExpandAll}
            className="px-2 py-1 text-xs font-mono text-ex-dim hover:text-ex-text transition-colors cursor-pointer"
          >
            展开
          </button>
          <button
            onClick={handleCollapseAll}
            className="px-2 py-1 text-xs font-mono text-ex-dim hover:text-ex-text transition-colors cursor-pointer"
          >
            折叠
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div className="max-h-[calc(100vh-400px)] overflow-y-auto">
        {tree.map((node) => (
          <TreeNodeComponent
            key={node.path}
            node={node}
            depth={0}
            expandedFolders={expandedFolders}
            activePath={activePath}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  )
}
