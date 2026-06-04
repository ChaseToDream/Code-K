import { spawn } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { statSync } from 'node:fs'

/**
 * 校验 repoPath 是否为合法的绝对路径且指向真实目录
 * @param {string} repoPath
 * @returns {string} 规范化后的绝对路径
 */
function validateRepoPath(repoPath) {
  if (!repoPath || typeof repoPath !== 'string') {
    throw new Error('仓库路径不能为空')
  }

  // 必须是绝对路径，禁止相对路径和 .. 遍历
  const normalized = resolve(repoPath)
  if (!normalized.startsWith(sep) && !/^[A-Za-z]:[\\\/]/.test(normalized)) {
    throw new Error('仓库路径必须是绝对路径')
  }

  // 禁止包含 null 字节
  if (normalized.includes('\0')) {
    throw new Error('仓库路径包含非法字符')
  }

  // 校验目标为真实目录
  try {
    const st = statSync(normalized)
    if (!st.isDirectory()) {
      throw new Error('仓库路径不是目录')
    }
  } catch (err) {
    throw new Error(`仓库路径不可访问: ${err.message}`)
  }

  return normalized
}

/**
 * 校验 git 参数，禁止执行非 git 子命令或包含危险字符
 * @param {string[]} args
 */
function validateGitArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('git 参数不能为空')
  }

  const dangerousChars = /[;&|`$(){}\[\]\\\n\r<>]/
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new Error('git 参数必须是字符串')
    }
    if (dangerousChars.test(arg)) {
      throw new Error(`git 参数包含非法字符: ${arg}`)
    }
  }
}

/**
 * 执行 git 命令并返回输出
 */
export function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    let validatedPath
    try {
      validatedPath = validateRepoPath(repoPath)
      validateGitArgs(args)
    } catch (err) {
      return reject(err)
    }

    const child = spawn('git', args, {
      cwd: validatedPath,
      env: { ...process.env, LANG: 'en_US.UTF-8' },
      shell: false, // 显式禁用 shell，防止注入
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')))
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) return reject(new Error(`git ${args.join(' ')} failed: ${stderr}`))
      resolve(stdout)
    })
    child.on('error', reject)
  })
}
