import { useMemo, useState } from 'react'

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  filePath: string;
  additions: number;
  deletions: number;
  onClose?: () => void;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  oldLineNum: number | null;
  newLineNum: number | null;
  content: string;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  // Simple diff algorithm (can be improved with LCS)
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx >= oldLines.length) {
      // Remaining new lines are additions
      result.push({
        type: 'added',
        oldLineNum: null,
        newLineNum: newIdx + 1,
        content: newLines[newIdx],
      });
      newIdx++;
    } else if (newIdx >= newLines.length) {
      // Remaining old lines are deletions
      result.push({
        type: 'removed',
        oldLineNum: oldIdx + 1,
        newLineNum: null,
        content: oldLines[oldIdx],
      });
      oldIdx++;
    } else if (oldLines[oldIdx] === newLines[newIdx]) {
      // Lines are the same
      result.push({
        type: 'unchanged',
        oldLineNum: oldIdx + 1,
        newLineNum: newIdx + 1,
        content: oldLines[oldIdx],
      });
      oldIdx++;
      newIdx++;
    } else {
      // Lines are different - mark as removed and added
      result.push({
        type: 'removed',
        oldLineNum: oldIdx + 1,
        newLineNum: null,
        content: oldLines[oldIdx],
      });
      result.push({
        type: 'added',
        oldLineNum: null,
        newLineNum: newIdx + 1,
        content: newLines[newIdx],
      });
      oldIdx++;
      newIdx++;
    }
  }

  return result;
}

export default function DiffViewer({ oldContent, newContent, filePath, additions, deletions, onClose }: DiffViewerProps) {
  const [showUnchanged, setShowUnchanged] = useState(true);

  const diffLines = useMemo(() => computeDiff(oldContent, newContent), [oldContent, newContent]);

  const filteredLines = useMemo(() => {
    if (showUnchanged) return diffLines;
    return diffLines.filter(line => line.type !== 'unchanged');
  }, [diffLines, showUnchanged]);

  const getLineClass = (type: DiffLine['type']) => {
    switch (type) {
      case 'added':
        return 'bg-ex-green/10 text-ex-green';
      case 'removed':
        return 'bg-ex-red/10 text-ex-red';
      default:
        return 'text-ex-text';
    }
  };

  const getLinePrefix = (type: DiffLine['type']) => {
    switch (type) {
      case 'added':
        return '+';
      case 'removed':
        return '-';
      default:
        return ' ';
    }
  };

  return (
    <div className="bg-ex-surface border border-ex-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-ex-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-ex-heading font-semibold">{filePath}</span>
          <span className="text-xs font-mono text-ex-green">+{additions}</span>
          <span className="text-xs font-mono text-ex-red">-{deletions}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUnchanged(!showUnchanged)}
            className="px-3 py-1 text-xs font-mono bg-ex-panel border border-ex-border rounded
              text-ex-dim hover:text-ex-text transition-colors cursor-pointer"
          >
            {showUnchanged ? '隐藏' : '显示'}未修改行
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-ex-dim hover:text-ex-red transition-colors p-1 cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Diff Content */}
      <div className="max-h-96 overflow-y-auto font-mono text-xs">
        {filteredLines.length === 0 ? (
          <div className="p-4 text-center text-ex-dim">无差异内容</div>
        ) : (
          filteredLines.map((line, idx) => (
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
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-ex-border text-xs font-mono text-ex-dim">
        共 {diffLines.length} 行，新增 {additions} 行，删除 {deletions} 行
      </div>
    </div>
  );
}
