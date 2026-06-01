/// <reference types="vite/client" />

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

interface FileSystemFileHandle {
  getFile(): Promise<File>
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>
  close(): Promise<void>
}

interface Window {
  showDirectoryPicker(options?: {
    mode?: 'read' | 'readwrite'
    id?: string
    startIn?: FileSystemHandle | string
  }): Promise<FileSystemDirectoryHandle>
}
