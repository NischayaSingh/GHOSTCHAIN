import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { assist } from './assist'

export default defineConfig({
  optimizeDeps: { exclude: ['kzg-wasm'] },
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [{
    name: 'ghostchain-ai',
    configureServer(server) { server.middlewares.use('/api/assist', (req, res) => void assist(req, res)) },
    configurePreviewServer(server) { server.middlewares.use('/api/assist', (req, res) => void assist(req, res)) },
  }],
  build: { outDir: '../../dist', emptyOutDir: true },
  worker: { format: 'es' },
})
