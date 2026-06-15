/**
 * numstat 解析器 — 统一解析 git --numstat / diff-tree --numstat 输出
 *
 * 解决历史问题：
 * 1. 重命名/移动文件丢失：git 对重命名输出 `path/{old => new}.ext`，旧逻辑直接吃下整个花括号字符串作为 path
 * 2. 二进制文件静默丢弃：`-\t-\tpath` 直接 continue，无日志无法追溯
 * 3. Unicode / 含特殊字符的路径：git 默认 core.quotePath 会给非 ASCII 字符加引号并转义
 *
 * 此模块为 4 处调用方（parser.js / watcher.js / repo.js / 前端 kline-data.ts 的对等逻辑）提供单一解析入口。
 */

/**
 * 解析单行 numstat 输出
 *
 * @example
 * parseNumstatLine('10\t5\tsrc/App.tsx')
 * // => { path: 'src/App.tsx', additions: 10, deletions: 5, isBinary: false, isRename: false }
 *
 * @example 重命名（git 默认输出）
 * parseNumstatLine('0\t0\tsrc/{Old => New}.tsx')
 * // => { path: 'src/New.tsx', renamedFrom: 'src/Old.tsx', additions: 0, deletions: 0, isBinary: false, isRename: true }
 *
 * @example 重命名（--numstat 带 -M 时完整形式）
 * parseNumstatLine('0\t0\tsrc/Old.tsx => src/New.tsx')
 * // => { path: 'src/New.tsx', renamedFrom: 'src/Old.tsx', additions: 0, deletions: 0, isBinary: false, isRename: true }
 *
 * @example 二进制文件
 * parseNumstatLine('-\t-\tpublic/logo.png')
 * // => { path: 'public/logo.png', additions: 0, deletions: 0, isBinary: true, isRename: false }
 *
 * @param {string} line - 单行 numstat 输出（不含换行符）
 * @returns {{path: string, renamedFrom?: string, additions: number, deletions: number, isBinary: boolean, isRename: boolean} | null}
 *   解析失败（空行、格式不符）返回 null
 */
export function parseNumstatLine(line) {
  if (!line || typeof line !== 'string') return null
  const trimmed = line.trim()
  if (!trimmed) return null

  // 拆分：additions \t deletions \t path（path 可能含空格、含 => 重命名语法、被引号包裹）
  const firstTab = trimmed.indexOf('\t')
  const secondTab = trimmed.indexOf('\t', firstTab + 1)
  if (firstTab === -1 || secondTab === -1) return null

  const additionsRaw = trimmed.slice(0, firstTab)
  const deletionsRaw = trimmed.slice(firstTab + 1, secondTab)
  let pathRaw = trimmed.slice(secondTab + 1)
  if (!pathRaw) return null

  const isBinary = additionsRaw === '-' || deletionsRaw === '-'
  const additions = additionsRaw === '-' ? 0 : parseInt(additionsRaw, 10)
  const deletions = deletionsRaw === '-' ? 0 : parseInt(deletionsRaw, 10)

  // 反转义 git 的引号路径（core.quotePath / 含特殊字符时 git 会加引号）
  pathRaw = unquoteGitPath(pathRaw)

  // 重命名检测：两种形式
  //  1. 简写：`prefix/{old => new}.ext`  或  `{old => new}.ext`  或  `dir/{old => new}/sub`
  //  2. 完整：`oldPath => newPath`
  const renameResult = resolveRename(pathRaw)
  if (renameResult) {
    return {
      path: renameResult.newPath,
      renamedFrom: renameResult.oldPath,
      additions,
      deletions,
      isBinary,
      isRename: true,
    }
  }

  return {
    path: pathRaw,
    additions,
    deletions,
    isBinary,
    isRename: false,
  }
}

/**
 * 解析 numstat 多行输出，返回解析后的文件变更列表
 * 注意：二进制文件也会被包含在结果中（带 isBinary 标记），由调用方决定是否跳过
 *
 * @param {string} output - git numstat 完整输出
 * @returns {Array<{path: string, renamedFrom?: string, additions: number, deletions: number, isBinary: boolean, isRename: boolean}>}
 */
export function parseNumstat(output) {
  if (!output) return []
  const results = []
  for (const line of output.split('\n')) {
    const parsed = parseNumstatLine(line)
    if (parsed) results.push(parsed)
  }
  return results
}

/**
 * 反转义 git 的引号路径
 * git 在路径含特殊字符（空格、非 ASCII、引号、反斜杠）时会用 C 风格转义并包裹双引号。
 * 例：`"src/文件 名.tsx"` → `src/文件 名.tsx`；`"src/\"q\".ts"` → `src/"q".ts`
 *
 * @param {string} raw
 * @returns {string}
 */
function unquoteGitPath(raw) {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') {
    return raw
  }
  // 去掉外层引号，反转义常见转义序列
  const inner = raw.slice(1, -1)
  return inner.replace(/\\(.)/g, (_, ch) => {
    switch (ch) {
      case 'n': return '\n'
      case 't': return '\t'
      case 'r': return '\r'
      case '"': return '"'
      case '\\': return '\\'
      default: return ch
    }
  })
}

/**
 * 解析 git 重命名语法，返回 { oldPath, newPath } 或 null（非重命名）
 *
 * 支持两种形式：
 *  - 简写花括号：`prefix/{old => new}.ext`  /  `{old => new}.ext`  /  `dir/{a => b}/sub`
 *  - 完整箭头：`old/path => new/path`
 *
 * @param {string} path
 * @returns {{oldPath: string, newPath: string} | null}
 */
function resolveRename(path) {
  // 形式 1：花括号简写  {old => new}
  const braceMatch = path.match(/^(.*)\{([^{}]*) => ([^{}]*)\}(.*)$/)
  if (braceMatch) {
    const [, prefix, oldPart, newPart, suffix] = braceMatch
    const oldPath = (prefix + oldPart + suffix).replace(/\/+/g, '/').replace(/\/$/, '')
    const newPath = (prefix + newPart + suffix).replace(/\/+/g, '/').replace(/\/$/, '')
    // 去掉开头可能残留的 /
    return {
      oldPath: oldPath.replace(/^\//, ''),
      newPath: newPath.replace(/^\//, ''),
    }
  }

  // 形式 2：完整箭头  old/path => new/path
  // 注意：箭头两侧各有空格，且两侧路径不含 " => " 子串（路径几乎不会含此序列）
  const arrowIdx = path.indexOf(' => ')
  if (arrowIdx !== -1) {
    const oldPath = path.slice(0, arrowIdx).trim()
    const newPath = path.slice(arrowIdx + 4).trim()
    if (oldPath && newPath) {
      return { oldPath, newPath }
    }
  }

  return null
}
