import esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')
const electronOutDir = join(projectRoot, 'electron', 'out')
const serverOutDir = join(projectRoot, 'server-out')

const nodeEnv = JSON.stringify(process.env.NODE_ENV || 'development')

// ==================== Electron 构建 ====================

/** 主进程打包配置 */
const mainConfig = {
  entryPoints: [join(projectRoot, 'electron', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: join(electronOutDir, 'main.js'),
  format: 'esm',
  external: ['electron', 'fsevents'],
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': nodeEnv,
  },
}

/** preload 打包配置 - 必须打包成单文件 IIFE，因为 sandbox 模式不支持 ESM */
const preloadConfig = {
  entryPoints: [join(projectRoot, 'electron', 'preload.ts')],
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  outfile: join(electronOutDir, 'preload.js'),
  format: 'iife',
  sourcemap: true,
  external: ['electron'],
}

/** logger 打包配置 */
const loggerConfig = {
  entryPoints: [join(projectRoot, 'electron', 'logger.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: join(electronOutDir, 'logger.js'),
  format: 'esm',
  external: ['electron'],
  sourcemap: true,
}

/** updater 打包配置 */
const updaterConfig = {
  entryPoints: [join(projectRoot, 'electron', 'updater.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: join(electronOutDir, 'updater.js'),
  format: 'esm',
  external: ['electron'],
  sourcemap: true,
}

// ==================== Server 构建 ====================

/** 后端服务打包 - 打包成单文件，避免携带 node_modules */
const serverConfig = {
  entryPoints: [join(projectRoot, 'server', 'index.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: join(serverOutDir, 'index.js'),
  format: 'esm',
  // ws 是原生 C++ 模块，不能被 esbuild 打包，需要外部提供
  external: ['ws'],
  sourcemap: true,
  // 排除测试文件
  ignoreAnnotations: true,
}

const electronConfigs = [mainConfig, preloadConfig, loggerConfig, updaterConfig]
const allConfigs = [...electronConfigs, serverConfig]

await Promise.all(allConfigs.map(c => esbuild.build(c)))
console.log('Electron + Server build complete.')
