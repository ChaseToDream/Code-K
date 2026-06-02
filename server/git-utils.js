import { spawn } from 'node:child_process'

/**
 * 执行 git 命令并返回输出
 */
export function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoPath,
      env: { ...process.env, LANG: 'en_US.UTF-8' },
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
