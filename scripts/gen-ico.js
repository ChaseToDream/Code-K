/**
 * 将 SVG 图标转换为 Windows .ico 文件
 * 生成 16x16, 32x32, 48x48, 256x256 四种尺寸
 */
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

const svgPath = join(projectRoot, 'public', 'favicon.svg')
const icoPath = join(projectRoot, 'public', 'favicon.ico')

const svgBuffer = readFileSync(svgPath)

// 生成多尺寸 PNG
const sizes = [16, 32, 48, 256]
const pngBuffers = await Promise.all(
  sizes.map(size =>
    sharp(svgBuffer, { density: Math.max(72, size * 3) })
      .resize(size, size)
      .png()
      .toBuffer()
  )
)

// ICO 文件格式：https://en.wikipedia.org/wiki/ICO_(file_format)
const headerSize = 6
const dirEntrySize = 16
const numImages = pngBuffers.length
const dirSize = dirEntrySize * numImages

// 计算每个图像数据的偏移量
const offsets = []
let offset = headerSize + dirSize
for (const buf of pngBuffers) {
  offsets.push(offset)
  offset += buf.length
}

// 构建 ICO 文件
const parts = []

// ICO Header (6 bytes)
const header = Buffer.alloc(headerSize)
header.writeUInt16LE(0, 0)       // 保留字段，必须为 0
header.writeUInt16LE(1, 2)       // 图像类型：1 = ICO
header.writeUInt16LE(numImages, 4) // 图像数量
parts.push(header)

// Directory entries
for (let i = 0; i < numImages; i++) {
  const entry = Buffer.alloc(dirEntrySize)
  const size = sizes[i]
  entry.writeUInt8(size >= 256 ? 0 : size, 0)  // 宽度（256用0表示）
  entry.writeUInt8(size >= 256 ? 0 : size, 1)  // 高度
  entry.writeUInt8(0, 2)          // 调色板数量
  entry.writeUInt8(0, 3)          // 保留
  entry.writeUInt16LE(1, 4)       // 色彩平面数
  entry.writeUInt16LE(32, 6)      // 每像素位数
  entry.writeUInt32LE(pngBuffers[i].length, 8)  // 图像数据大小
  entry.writeUInt32LE(offsets[i], 12)            // 图像数据偏移
  parts.push(entry)
}

// 图像数据
for (const buf of pngBuffers) {
  parts.push(buf)
}

const ico = Buffer.concat(parts)
writeFileSync(icoPath, ico)
console.log(`Generated ${icoPath} (${ico.length} bytes)`)
