import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps the build portable: it runs from any folder or static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // modo API (VITE_API_MODE=1): o painel fala com o servidor na mesma origem,
    // então o cookie de sessão (SameSite=Strict) funciona sem CORS.
    proxy: {
      '/api': { target: 'http://localhost:3333', changeOrigin: false },
    },
  },
  preview: {
    proxy: {
      '/api': { target: 'http://localhost:3333', changeOrigin: false },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
})
