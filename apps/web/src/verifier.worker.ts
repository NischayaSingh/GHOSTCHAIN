import { loadKZG } from 'kzg-wasm'
import { verifyOpenings } from '@ghostchain/core/commit'
import type { VerifyRequest, WorkerMessage, WorkerReply } from './protocol'

let kzg: ReturnType<typeof loadKZG> | undefined

self.onmessage = async (event: MessageEvent<WorkerMessage<VerifyRequest>>) => {
  const { id, request } = event.data
  let reply: WorkerReply
  try {
    kzg ??= loadKZG().catch(error => {
      kzg = undefined
      throw error
    })
    const verifier = await kzg
    reply = { id, value: request.kind === 'warmup'
      ? true
      : await verifyOpenings(verifier, request.commitments, request.openings) }
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(reply)
}
