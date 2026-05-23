import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'web'),
  base: '/',
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5273,
    proxy: {
      '/api': 'http://localhost:4318',
      '/v1': 'http://localhost:4318',
      '/healthz': 'http://localhost:4318',
    },
  },
  plugins: [react()],
})
