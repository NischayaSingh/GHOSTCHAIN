import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { createApi } from '../server/api'

export default defineConfig({
  optimizeDeps: { exclude: ['kzg-wasm'] },
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [{
    name: 'ghostchain-api',
    configureServer(server) {
      const api = createApi(new URL('./public/', import.meta.url))
      server.middlewares.use(api.middleware)
      server.httpServer?.once('close', api.close)
    },
    configurePreviewServer(server) {
      const api = createApi(new URL('../../dist/', import.meta.url))
      server.middlewares.use(api.middleware)
      server.httpServer.once('close', api.close)
    },
  }],
  build: { outDir: '../../dist', emptyOutDir: true },
  worker: { format: 'es' },
})
