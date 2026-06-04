import type { FileStock, CommitDiff } from './types'

const DB_NAME = 'codex-cache'
const DB_VERSION = 1
const STORE_NAME = 'repos'

interface CachedRepo {
  id: string
  name: string
  path: string
  stocks: FileStock[]
  commits: CommitDiff[]
  timestamp: number
  commitCount: number
}

/**
 * 打开 IndexedDB 数据库，若检测到存储文件损坏则自动删除并重建
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      const err = request.error
      const msg = err?.message || ''
      // Chrome 存储文件损坏时会抛出 "Data lost due to missing file" 错误
      if (msg.includes('Data lost due to missing file') || msg.includes('missing file')) {
        console.warn('[Cache] IndexedDB 数据损坏，正在重建数据库...')
        const delReq = indexedDB.deleteDatabase(DB_NAME)
        delReq.onerror = () => {
          // 删除也失败时直接重试（Chrome 可能已自动清理）
          openDB().then(resolve, reject)
        }
        delReq.onsuccess = () => {
          openDB().then(resolve, reject)
        }
        return
      }
      reject(err)
    }
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

export async function getCachedRepo(repoId: string): Promise<CachedRepo | null> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(repoId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || null)
    })
  } catch {
    return null
  }
}

export async function setCachedRepo(repo: CachedRepo): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(repo)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch {
    // Ignore cache errors
  }
}

export async function deleteCachedRepo(repoId: string): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(repoId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch {
    // Ignore cache errors
  }
}

export async function getAllCachedRepos(): Promise<CachedRepo[]> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || [])
    })
  } catch {
    return []
  }
}

export async function clearCache(): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch {
    // Ignore cache errors
  }
}
