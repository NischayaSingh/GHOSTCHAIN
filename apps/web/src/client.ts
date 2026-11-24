import { detectionConfidence, sampleIndices, sessionBytes } from '@ghostchain/core/das'
import { BLOCK_BYTES, CELLS } from '@ghostchain/core/model'
import type { OpeningPacket, VerifyRequest, VerifyResult } from './protocol'
import type { WorkerRpc } from './rpc'
import type { NetworkApi } from './network-api'

export type SampleState = 'verified' | 'missing' | 'invalid'

export interface Session {
  height: number
  blockId: string
  seed: number
  samples: { index: number, state: SampleState }[]
  count: number
  rounds: number
  timings: number[]
  bytes: number
  share: number
  httpBodyBytes?: number
  confidence: number
  tampered: boolean
}

export async function sample(
  network: NetworkApi, verifier: WorkerRpc<VerifyRequest>,
  count: number, rounds: number, tamper: boolean,
): Promise<Session> {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]
  const indices = sampleIndices(seed, count * rounds, CELLS)
  const { blockId, height, commitments, openings, httpBodyBytes } = await network.call<OpeningPacket>({ kind: 'openings', indices })
  const byIndex = new Map(openings.map(opening => [opening.index, opening]))
  if (tamper && openings.length) {
    const original = openings[0]
    const modified = original.data.slice()
    modified[0] ^= 0x80
    byIndex.set(original.index, { ...original, data: modified })
  }
  const samples: Session['samples'] = []
  const timings: number[] = []
  for (let round = 0; round < rounds; round++) {
    const batch = indices.slice(round * count, (round + 1) * count)
    const available = batch.flatMap(index => {
      const opening = byIndex.get(index)
      return opening ? [opening] : []
    })
    const verification = await verifier.call<VerifyResult>({ kind: 'verify', commitments, openings: available })
    timings.push(verification.ms)
    const verified = new Map(available.map((opening, i) => [opening.index, verification.accepted[i]]))
    samples.push(...batch.map(index => ({
      index, state: !verified.has(index) ? 'missing' as const : verified.get(index) ? 'verified' as const : 'invalid' as const,
    })))
  }
  const bytes = sessionBytes(indices.length, openings.length, true)
  return {
    height, blockId, seed, samples, count, rounds, timings, bytes, httpBodyBytes, share: bytes / BLOCK_BYTES * 100, tampered: tamper,
    confidence: samples.every(item => item.state === 'verified') ? detectionConfidence(samples.length) : 0,
  }
}
