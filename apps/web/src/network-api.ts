import type { NetworkRequest, OpeningPacket } from './protocol'

type WireOpeningPacket = {
  height: number
  blockId: string
  commitments: string[]
  openings: { index: number, data: string, sibling: string, proof: string }[]
}

function encode(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

function decode(value: string) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}

export class NetworkApi {
  private session?: string
  private pending = Promise.resolve()

  call<R>(request: NetworkRequest): Promise<R> {
    const result = this.pending.then(() => this.send<R>(request))
    this.pending = result.then(() => {}, () => {})
    return result
  }

  private async send<R>(request: NetworkRequest): Promise<R> {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (this.session) headers.set('X-Ghostchain-Session', this.session)
    const body = JSON.stringify(request.kind === 'publish' && request.input
      ? { ...request, input: encode(request.input) }
      : request)
    const response = await fetch('/api/sim', {
      method: 'POST', headers, body, signal: AbortSignal.timeout(120_000),
    })
    if (!response.headers.get('Content-Type')?.includes('application/json')) {
      throw new Error('Simulation API unavailable. Open the app from the running Node server.')
    }
    const raw = await response.text()
    const value = JSON.parse(raw)
    if (!response.ok) throw new Error(value.error ?? `Simulation API returned HTTP ${response.status}`)
    this.session = response.headers.get('X-Ghostchain-Session') ?? this.session
    if (request.kind !== 'openings') return value as R
    const packet = value as WireOpeningPacket
    const openingPacket: OpeningPacket = {
      ...packet,
      commitments: packet.commitments.map(decode),
      openings: packet.openings.map(item => ({
        index: item.index, data: decode(item.data), sibling: decode(item.sibling), proof: decode(item.proof),
      })),
      httpBodyBytes: new TextEncoder().encode(body).length + new TextEncoder().encode(raw).length,
    }
    return openingPacket as R
  }
}
