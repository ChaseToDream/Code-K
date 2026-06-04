import { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage, powerMonitor } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn, ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 环境判断
const isDev = process.env.NODE_ENV === 'development'

/**
 * 获取应用根目录（兼容开发、打包、portable 模式）
 */
function getAppRoot(): string {
  if (isDev) {
    return join(__dirname, '..')
  }
  // portable 模式下 process.resourcesPath 指向临时解压目录
  // 用 app.getAppPath() 更可靠，它指向 app.asar 或 unpacked 目录的父级
  const appPath = app.getAppPath()
  // app.getAppPath() 在 asar 模式下指向 app.asar 文件本身，需要取父目录
  return dirname(appPath)
}

// 防止多开 - 必须在 app.whenReady() 之前调用
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

// 窗口状态
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let backendProcess: ChildProcess | null = null

// 后端端口
const BACKEND_PORT = 3001

// 性能监控
const perfMarks = {
  start: 0,
  backendReady: 0,
  windowReady: 0,
}

/**
 * 启动内嵌 Node.js 后端服务
 */
function startBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverPath = isDev
      ? join(__dirname, '..', 'server-out', 'index.js')
      : join(getAppRoot(), 'resources', 'server', 'index.js')

    if (!existsSync(serverPath)) {
      reject(new Error(`后端服务文件不存在: ${serverPath}`))
      return
    }

    console.log('[Electron] 启动后端服务:', serverPath)

    backendProcess = spawn('node', [serverPath], {
      env: { ...process.env, PORT: String(BACKEND_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let started = false

    backendProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString().trim()
      console.log('[Backend]', output)
      if (output.includes('服务器已启动') && !started) {
        started = true
        perfMarks.backendReady = performance.now()
        console.log(`[Performance] 后端启动耗时: ${(perfMarks.backendReady - perfMarks.start).toFixed(0)}ms`)
        resolve()
      }
    })

    backendProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Backend Error]', data.toString().trim())
    })

    backendProcess.on('error', (err) => {
      console.error('[Backend Process Error]', err)
      if (!started) reject(err)
    })

    backendProcess.on('exit', (code) => {
      console.log(`[Backend] 进程退出，代码: ${code}`)
      backendProcess = null
    })

    // 5秒超时兜底
    setTimeout(() => {
      if (!started) {
        started = true
        resolve()
      }
    }, 5000)
  })
}

/**
 * 停止后端服务
 */
function stopBackend() {
  if (backendProcess) {
    console.log('[Electron] 停止后端服务')
    backendProcess.kill('SIGTERM')
    backendProcess = null
  }
}

/**
 * 创建主窗口 - 性能优化版本
 */
function createWindow() {
  perfMarks.start = performance.now()

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Code-K - 代码交易所',
    show: false, // 先不显示，等加载完成再显示，避免白屏
    backgroundColor: '#0a0e1a', // 与主题一致的背景色
    titleBarStyle: 'hidden', // Windows 隐藏默认标题栏
    titleBarOverlay: {
      color: '#0f172a',
      symbolColor: '#94a3b8',
      height: 36,
    },
    // 性能优化选项
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 性能相关
      backgroundThrottling: true, // 后台时限制渲染
      offscreen: false,
      // 禁用不必要的功能
      webSecurity: !isDev, // 生产环境启用安全策略
      allowRunningInsecureContent: false,
    },
    // 窗口优化
    paintWhenInitiallyHidden: true,
    thickFrame: true, // Windows 原生边框
  })

  // 加载页面
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'))
  }

  // 加载完成后显示窗口（避免白屏）
  mainWindow.once('ready-to-show', () => {
    perfMarks.windowReady = performance.now()
    console.log(`[Performance] 窗口就绪耗时: ${(perfMarks.windowReady - perfMarks.start).toFixed(0)}ms`)

    mainWindow?.show()
    mainWindow?.focus()

    // 启动后清理控制台（生产环境）
    if (!isDev) {
      mainWindow?.webContents.executeJavaScript('console.clear()').catch(() => {})
    }
  })

  // 窗口关闭时隐藏到托盘（仅 Windows）
  mainWindow.on('close', (event) => {
    if (process.platform === 'win32' && tray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 窗口失去焦点时降低资源占用
  mainWindow.on('blur', () => {
    if (!isDev) {
      mainWindow?.webContents.setFrameRate(30) // 降低帧率
    }
  })

  mainWindow.on('focus', () => {
    mainWindow?.webContents.setFrameRate(60) // 恢复帧率
  })

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 内存监控（每30秒）
  if (!isDev) {
    setInterval(() => {
      const usage = process.memoryUsage()
      console.log(`[Memory] RSS: ${(usage.rss / 1024 / 1024).toFixed(1)}MB, Heap: ${(usage.heapUsed / 1024 / 1024).toFixed(1)}MB`)
    }, 30000)
  }
}

/**
 * 创建系统托盘
 */
function createTray() {
  const iconPath = join(__dirname, '..', 'public', 'favicon.svg')
  const trayIcon = nativeImage.createFromPath(iconPath)

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Code-K - 代码交易所')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        tray = null
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
      }
    } else {
      createWindow()
    }
  })
}

/**
 * 创建应用菜单（Windows 风格）
 */
function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开仓库...',
          accelerator: 'Ctrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ['openDirectory'],
              title: '选择 Git 仓库',
            })
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send('menu-open-repo', result.filePaths[0])
            }
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'Ctrl+R',
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: '开发者工具',
          accelerator: 'F12',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        {
          label: '实际大小',
          accelerator: 'Ctrl+0',
          click: () => mainWindow?.webContents.setZoomLevel(0),
        },
        {
          label: '放大',
          accelerator: 'Ctrl+=',
          click: () => {
            const level = mainWindow?.webContents.getZoomLevel() || 0
            mainWindow?.webContents.setZoomLevel(level + 0.5)
          },
        },
        {
          label: '缩小',
          accelerator: 'Ctrl+-',
          click: () => {
            const level = mainWindow?.webContents.getZoomLevel() || 0
            mainWindow?.webContents.setZoomLevel(level - 0.5)
          },
        },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 Code-K',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: '关于 Code-K',
              message: 'Code-K - 代码交易所',
              detail: '版本: 1.0.0\n把 Git 仓库当成股市来可视化。',
              buttons: ['确定'],
            })
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// ==================== IPC 通信 ====================

/**
 * 处理选择文件夹请求
 */
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: '选择 Git 仓库文件夹',
  })
  return result.canceled ? null : result.filePaths[0]
})

/**
 * 获取应用版本
 */
ipcMain.handle('app:getVersion', () => app.getVersion())

/**
 * 获取平台信息
 */
ipcMain.handle('app:getPlatform', () => process.platform)

/**
 * 窗口控制
 */
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.handle('window:close', () => mainWindow?.close())

// ==================== 应用生命周期 ====================

// 第二个实例启动时的处理
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  try {
    // 启动后端服务
    await startBackend()

    // 创建窗口和菜单
    createMenu()
    createWindow()
    createTray()

    // 电源管理优化
    powerMonitor.on('suspend', () => {
      console.log('[Power] 系统休眠，暂停后台任务')
      mainWindow?.webContents.send('power-suspend')
    })

    powerMonitor.on('resume', () => {
      console.log('[Power] 系统恢复')
      mainWindow?.webContents.send('power-resume')
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      } else {
        mainWindow?.show()
      }
    })
  } catch (err) {
    console.error('[Electron] 启动失败:', err)
    dialog.showErrorBox('启动失败', `无法启动后端服务: ${err instanceof Error ? err.message : String(err)}`)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBackend()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopBackend()
})

// 垃圾回收提示（每5分钟）
if (!isDev) {
  setInterval(() => {
    if (global.gc) {
      global.gc()
      console.log('[GC] 手动触发垃圾回收')
    }
  }, 300000)
}
