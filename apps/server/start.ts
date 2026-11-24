import { access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import sirv from 'sirv'
import { createApi } from './api.ts'

const root = new URL('../../dist/', import.meta.url)
await Promise.all([access(new URL('index.html', root)), access(new URL('blocks/20261120.bin', root))])
  .catch(() => { throw new Error('The app build is missing. Run npm run build first.') })

const serve = sirv(fileURLToPath(root), { dev: true, etag: true })
const api = createApi(root)
const server = createServer({ requestTimeout: 30_000 }, (req, res) => {
  api.middleware(req, res, () => {
    if (!req.url?.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD')) {
      return serve(req, res, missing)
    }
    missing()

    function missing() {
      res.statusCode = 404
      res.end('Not found')
    }
  })
})
server.once('close', api.close)

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 4173)
server.listen(port, host, () => console.log(`GHOSTCHAIN listening on http://${host}:${port}`))
