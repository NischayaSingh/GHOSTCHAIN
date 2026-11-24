import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { BLOCK_BYTES, CELLS } from '@ghostchain/core/model'
import type { NetworkRequest } from '../web/src/protocol.ts'
import { assist } from '../web/assist.ts'
import { createSimulation } from './simulation.ts'

const maxBody = Math.ceil((BLOCK_BYTES - 4) / 3) * 4 + 1024
const idleMs = 5 * 60 * 1000
const maxSessions = 8

class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readRequest(req: IncomingMessage): Promise<NetworkRequest> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new ApiError(415, 'Send application/json')
  }
  if (Number(req.headers['content-length']) > maxBody) throw new ApiError(413, 'Input exceeds one block')
  const chunks: Buffer[] = []
  let size = 0
  // Keep the socket available for a 413 response if a streamed body exceeds the limit.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > maxBody) {
      req.resume()
      throw new ApiError(413, 'Input exceeds one block')
    }
    chunks.push(chunk)
  }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new ApiError(400, 'Invalid JSON') }
  const invalid = () => new ApiError(400, 'Invalid simulation request')
  if (!value || typeof value !== 'object') throw invalid()
  const { kind, controls, seed, indices, fixture, input } = value
  const inRange = (n: unknown, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max
  switch (kind) {
    case 'audit': return { kind }
    case 'openings':
      if (!Array.isArray(indices) || indices.length < 1 || indices.length > 60 ||
          !indices.every(index => inRange(index, CELLS - 1)) || new Set(indices).size !== indices.length ||
          (fixture !== undefined && typeof fixture !== 'boolean')) throw invalid()
      return { kind, indices, fixture }
    case 'tick':
    case 'reset':
    case 'publish':
      if (!controls || !inRange(controls.faults, 100) || !inRange(controls.withholding, 100) ||
          !inRange(controls.latency, 500)) throw invalid()
      const settings = { faults: controls.faults, withholding: controls.withholding, latency: controls.latency }
      if (kind === 'reset') {
        if (!inRange(seed, 0xffffffff)) throw invalid()
        return { kind, controls: settings, seed }
      }
      if (kind === 'publish') {
        if (input === undefined) return { kind, controls: settings }
        if (typeof input !== 'string' || !input.length || input.length % 4 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) throw invalid()
        const decoded = Buffer.from(input, 'base64')
        if (!decoded.length || decoded.length > BLOCK_BYTES - 4) throw new ApiError(413, 'Input exceeds one block')
        return { kind, controls: settings, input: decoded }
      }
      return { kind, controls: settings }
    default: throw invalid()
  }
}

export function createApi(assetRoot: URL) {
  const trustedOrigins = new Set((process.env.GHOSTCHAIN_TRUSTED_ORIGINS ?? '')
    .split(',').map(origin => origin.trim()).filter(Boolean))
  const sessions = new Map<string, {
    handle: ReturnType<typeof createSimulation>, busy: boolean, touched: number,
  }>()
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) {
      if (!session.busy && Date.now() - session.touched >= idleMs) sessions.delete(id)
    }
  }, 30_000)
  cleanup.unref()

  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = req.url?.split('?')[0]
    if (path === '/api/assist') return assist(req, res)
    if (path !== '/api/sim' && path !== '/api/health') return next()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    const reply = (status: number, value: object) => {
      res.statusCode = status
      res.end(JSON.stringify(value, (_, item: unknown) =>
        item instanceof Uint8Array ? Buffer.from(item).toString('base64') : item))
    }
    if (path === '/api/health' && req.method === 'GET') {
      return reply(200, { status: 'ok', service: 'ghostchain-simulation' })
    }
    if (path !== '/api/sim' || req.method !== 'POST') {
      res.setHeader('Allow', path === '/api/sim' ? 'POST' : 'GET')
      return reply(405, { error: 'Method not allowed' })
    }
    const { origin, host } = req.headers
    if (origin && origin !== `http://${host}` && origin !== `https://${host}` && !trustedOrigins.has(origin)) {
      return reply(403, { error: 'Send simulation requests from this app' })
    }
    try {
      const request = await readRequest(req)
      const existing = req.headers['x-ghostchain-session']
      if (existing !== undefined && typeof existing !== 'string') throw new ApiError(400, 'Invalid session')
      if (!existing && request.kind !== 'tick' && request.kind !== 'reset') throw new ApiError(400, 'Start with a tick or reset')
      const id = existing ?? randomUUID()
      let session = sessions.get(id)
      if (!session) {
        if (existing !== undefined) throw new ApiError(410, 'The simulation session ended. Refresh to start a new session.')
        if (sessions.size >= maxSessions) throw new ApiError(503, 'All simulation slots are busy. Try again in a few minutes.')
        session = { handle: createSimulation(assetRoot), busy: false, touched: Date.now() }
        sessions.set(id, session)
      }
      if (session.busy) throw new ApiError(409, 'A simulation request is already running')
      session.busy = true
      try {
        const result = await session.handle(request)
        res.setHeader('X-Ghostchain-Session', id)
        reply(200, result)
      } catch (error) {
        if (!existing) sessions.delete(id)
        throw error
      } finally {
        session.busy = false
        session.touched = Date.now()
      }
    } catch (error) {
      if (error instanceof ApiError) return reply(error.status, { error: error.message })
      console.error('[ghostchain-simulation]', error)
      reply(500, { error: 'The server could not complete this simulation action. Check the server log.' })
    }
  }

  return {
    middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
      void handle(req, res, next)
    },
    close() { clearInterval(cleanup) },
  }
}
