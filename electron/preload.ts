import { contextBridge, ipcRenderer } from 'electron'

/**
 * Electron 预加载脚本
 * 在渲染进程中暴露安全的 API
 */

export interface ElectronAPI {
  // 对话框
  selectFolder: () => Promise<string | null>

  // 应用信息
  getVersion: () => Promise<string>
  getPlatform: () => Promise<string>

  // 窗口控制
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>

  // 菜单事件监听
  onMenuOpenRepo: (callback: (path: string) => void) => () => void
}

const api: ElectronAPI = {
  /**
   * 打开文件夹选择对话框
   */
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  /**
   * 获取应用版本号
   */
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  /**
   * 获取操作系统平台
   */
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  /**
   * 最小化窗口
   */
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),

  /**
   * 最大化/还原窗口
   */
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),

  /**
   * 关闭窗口
   */
  closeWindow: () => ipcRenderer.invoke('window:close'),

  /**
   * 监听菜单"打开仓库"事件
   * @returns 取消监听的函数
   */
  onMenuOpenRepo: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, path: string) => callback(path)
    ipcRenderer.on('menu-open-repo', handler)
    return () => ipcRenderer.off('menu-open-repo', handler)
  },
}

// 暴露 API 到 window.electron
contextBridge.exposeInMainWorld('electron', api)

// 类型声明扩展
declare global {
  interface Window {
    electron: ElectronAPI
  }
}
