/**
 * numstat-parser 测试 —— 覆盖普通/二进制/重命名/Unicode/复制/边界场景
 */
import { describe, it, expect } from 'vitest'
import { parseNumstatLine, parseNumstat } from './numstat-parser.js'

describe('parseNumstatLine', () => {
  describe('普通文件行', () => {
    it('解析标准 numstat 行', () => {
      const r = parseNumstatLine('10\t5\tsrc/App.tsx')
      expect(r).toEqual({
        path: 'src/App.tsx',
        additions: 10,
        deletions: 5,
        isBinary: false,
        isRename: false,
      })
    })

    it('路径含空格也能正确解析', () => {
      const r = parseNumstatLine('3\t1\tsrc/my file.ts')
      expect(r?.path).toBe('src/my file.ts')
      expect(r?.additions).toBe(3)
    })

    it('纯新增文件（deletions=0）', () => {
      const r = parseNumstatLine('100\t0\tnew-file.ts')
      expect(r?.additions).toBe(100)
      expect(r?.deletions).toBe(0)
      expect(r?.isBinary).toBe(false)
    })

    it('纯删除文件（additions=0）', () => {
      const r = parseNumstatLine('0\t50\tremoved.ts')
      expect(r?.additions).toBe(0)
      expect(r?.deletions).toBe(50)
    })

    it('复制/移动（0/0）保留为有效变更', () => {
      const r = parseNumstatLine('0\t0\tcopy.tsx')
      expect(r).not.toBeNull()
      expect(r?.additions).toBe(0)
      expect(r?.deletions).toBe(0)
      expect(r?.isRename).toBe(false)
    })
  })

  describe('二进制文件', () => {
    it('识别 -\t-\t 标记的二进制文件', () => {
      const r = parseNumstatLine('-\t-\tpublic/logo.png')
      expect(r?.isBinary).toBe(true)
      expect(r?.path).toBe('public/logo.png')
      expect(r?.additions).toBe(0)
      expect(r?.deletions).toBe(0)
    })

    it('二进制文件不误判为重命名', () => {
      const r = parseNumstatLine('-\t-\tpublic/{a => b}.png')
      // 即便含花括号，二进制标记优先识别；但若同时是重命名，仍应给出 renamedFrom
      expect(r?.isBinary).toBe(true)
    })
  })

  describe('重命名 / 移动', () => {
    it('解析花括号简写重命名 prefix/{old => new}.ext', () => {
      const r = parseNumstatLine('0\t0\tsrc/{Old => New}.tsx')
      expect(r?.isRename).toBe(true)
      expect(r?.path).toBe('src/New.tsx')
      expect(r?.renamedFrom).toBe('src/Old.tsx')
    })

    it('解析纯花括号重命名 {old => new}.ext（无前缀）', () => {
      const r = parseNumstatLine('0\t0\t{old => new}.ts')
      expect(r?.isRename).toBe(true)
      expect(r?.path).toBe('new.ts')
      expect(r?.renamedFrom).toBe('old.ts')
    })

    it('解析目录层级中的重命名 dir/{a => b}/sub.ts', () => {
      const r = parseNumstatLine('0\t0\tpkg/{a => b}/sub.ts')
      expect(r?.isRename).toBe(true)
      expect(r?.path).toBe('pkg/b/sub.ts')
      expect(r?.renamedFrom).toBe('pkg/a/sub.ts')
    })

    it('解析完整箭头重命名 old/path => new/path', () => {
      const r = parseNumstatLine('0\t0\tsrc/old/App.tsx => src/new/App.tsx')
      expect(r?.isRename).toBe(true)
      expect(r?.path).toBe('src/new/App.tsx')
      expect(r?.renamedFrom).toBe('src/old/App.tsx')
    })

    it('重命名同时带行变更', () => {
      const r = parseNumstatLine('5\t2\tsrc/{Old => New}.tsx')
      expect(r?.isRename).toBe(true)
      expect(r?.additions).toBe(5)
      expect(r?.deletions).toBe(2)
      expect(r?.renamedFrom).toBe('src/Old.tsx')
    })
  })

  describe('Unicode / 带引号路径', () => {
    it('解析含中文且带引号的路径', () => {
      // git core.quotePath 会给非 ASCII 加引号
      const r = parseNumstatLine('10\t5\t"src/文件 名.tsx"')
      expect(r?.path).toBe('src/文件 名.tsx')
      expect(r?.additions).toBe(10)
    })

    it('反转义路径中的转义字符', () => {
      const r = parseNumstatLine('1\t0\t"src/\\"q\\".ts"')
      expect(r?.path).toBe('src/"q".ts')
    })

    it('路径含反斜杠转义序列', () => {
      const r = parseNumstatLine('1\t0\t"src/a\\\\b.ts"')
      expect(r?.path).toBe('src/a\\b.ts')
    })
  })

  describe('边界情况', () => {
    it('空行返回 null', () => {
      expect(parseNumstatLine('')).toBeNull()
      expect(parseNumstatLine('   ')).toBeNull()
    })

    it('只有空白字符返回 null', () => {
      expect(parseNumstatLine('\t\t')).toBeNull()
    })

    it('少于 3 列返回 null', () => {
      expect(parseNumstatLine('10\t5')).toBeNull()
      expect(parseNumstatLine('10')).toBeNull()
    })

    it('null/undefined/非字符串返回 null', () => {
      expect(parseNumstatLine(null)).toBeNull()
      expect(parseNumstatLine(undefined)).toBeNull()
    })
  })
})

describe('parseNumstat（多行）', () => {
  it('解析完整 numstat 输出块', () => {
    const output = [
      '10\t5\tsrc/App.tsx',
      '-\t-\tpublic/logo.png',
      '0\t0\tsrc/{Old => New}.tsx',
      '3\t1\tnew-file.ts',
      '',
      '  ',
    ].join('\n')

    const results = parseNumstat(output)
    expect(results).toHaveLength(4)
    expect(results[0].path).toBe('src/App.tsx')
    expect(results[1].isBinary).toBe(true)
    expect(results[2].isRename).toBe(true)
    expect(results[3].path).toBe('new-file.ts')
  })

  it('空输出返回空数组', () => {
    expect(parseNumstat('')).toEqual([])
    expect(parseNumstat(null)).toEqual([])
  })

  it('保留二进制文件记录（由调用方决定跳过）', () => {
    const results = parseNumstat('-\t-\ta.png\n-\t-\tb.jpg')
    expect(results).toHaveLength(2)
    expect(results.every(r => r.isBinary)).toBe(true)
  })
})
