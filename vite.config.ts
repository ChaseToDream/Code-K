import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  base: './', // Electron 中使用相对路径
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 代码分割优化
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/lightweight-charts')) {
            return 'vendor-charts'
          }
          if (id.includes('node_modules/react-window')) {
            return 'vendor-ui'
          }
        },
      },
    },
    // 压缩优化
    minify: 'esbuild',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
