import { app, dialog, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { logger } from './logger.js'

/**
 * 更新信息接口
 */
interface UpdateInfo {
  version: string
  downloadUrl: string
  releaseNotes: string
  mandatory: boolean
}

/**
 * 当前版本信息
 */
interface VersionInfo {
  version: string
  checkDate: number
  skippedVersion?: string
}

/**
 * 自动更新管理器
 * 注意：这是一个基础实现，实际项目中可以集成 electron-updater
 */
class UpdateManager {
  private versionFile: string
  private checkInterval: number = 24 * 60 * 60 * 1000 // 24小时
  private updateUrl: string = 'https://api.github.com/repos/your-org/code-k/releases/latest'

  constructor() {
    this.versionFile = join(app.getPath('userData'), 'version.json')
  }

  /**
   * 读取本地版本信息
   */
  private readVersionInfo(): VersionInfo {
    try {
      if (existsSync(this.versionFile)) {
        return JSON.parse(readFileSync(this.versionFile, 'utf-8'))
      }
    } catch (err) {
      logger.error(`Failed to read version info: ${err}`, 'Updater')
    }
    return {
      version: app.getVersion(),
      checkDate: 0,
    }
  }

  /**
   * 保存版本信息
   */
  private saveVersionInfo(info: VersionInfo) {
    try {
      writeFileSync(this.versionFile, JSON.stringify(info, null, 2), 'utf-8')
    } catch (err) {
      logger.error(`Failed to save version info: ${err}`, 'Updater')
    }
  }

  /**
   * 检查是否需要检查更新
   */
  shouldCheck(): boolean {
    const info = this.readVersionInfo()
    return Date.now() - info.checkDate > this.checkInterval
  }

  /**
   * 检查更新（模拟实现）
   * 实际项目中应该从服务器获取最新版本信息
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async checkForUpdates(_parentWindow?: BrowserWindow): Promise<UpdateInfo | null> {
    logger.info('Checking for updates...', 'Updater')

    try {
      // 这里模拟从服务器获取更新信息
      // 实际项目中应该调用真实的 API
      const currentVersion = app.getVersion()

      // 模拟：检查 GitHub releases（需要替换为实际的 API）
      // const response = await fetch(this.updateUrl)
      // const data = await response.json()
      // const latestVersion = data.tag_name.replace('v', '')

      // 更新检查时间
      const info = this.readVersionInfo()
      info.checkDate = Date.now()
      this.saveVersionInfo(info)

      logger.info(`Current version: ${currentVersion}`, 'Updater')

      // 模拟没有更新（实际项目中应该比较版本号）
      return null
    } catch (err) {
      logger.error(`Update check failed: ${err}`, 'Updater')
      return null
    }
  }

  /**
   * 显示更新对话框
   */
  async showUpdateDialog(updateInfo: UpdateInfo, parentWindow?: BrowserWindow) {
    const result = await dialog.showMessageBox(parentWindow || (undefined as unknown as BrowserWindow), {
      type: 'info',
      title: '发现新版本',
      message: `Code-K ${updateInfo.version} 已发布`,
      detail: `${updateInfo.releaseNotes}\n\n是否立即下载更新？`,
      buttons: ['立即下载', '稍后提醒', '跳过此版本'],
      defaultId: 0,
      cancelId: 1,
    })

    switch (result.response) {
      case 0: { // 立即下载
        // 打开下载页面
        const { shell } = await import('electron')
        await shell.openExternal(updateInfo.downloadUrl)
        break
      }
      case 2: { // 跳过此版本
        const info = this.readVersionInfo()
        info.skippedVersion = updateInfo.version
        this.saveVersionInfo(info)
        break
      }
    }
  }

  /**
   * 启动时检查更新
   */
  async checkOnStartup(parentWindow?: BrowserWindow) {
    if (!this.shouldCheck()) {
      logger.info('Skipping update check (checked recently)', 'Updater')
      return
    }

    const updateInfo = await this.checkForUpdates(parentWindow)
    if (updateInfo) {
      const info = this.readVersionInfo()
      if (info.skippedVersion === updateInfo.version) {
        logger.info(`Skipped version ${updateInfo.version}`, 'Updater')
        return
      }
      await this.showUpdateDialog(updateInfo, parentWindow)
    }
  }
}

export const updateManager = new UpdateManager()
