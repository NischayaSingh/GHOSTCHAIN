import { hex, sha256 } from './bytes.ts'
import { rng } from './random.ts'
import type { Shard } from './erasure.ts'
import type { Node } from './sim.ts'

export const AUDIT_REWARD = 3
export const AUDIT_SLASH = 8
export const STORAGE_COST = 0.6

export interface AuditEvent {
  round: number
  node: number
  cell: number
  outcome: 'rewarded' | 'slashed' | 'offline'
  change: number
  commitment: string
  nonce: string | null
}

const encoder = new TextEncoder()
async function commit(round: number, node: number, cell: number, digest: string, nonce: string) {
  return hex(await sha256(encoder.encode(JSON.stringify(['ghostchain/audit/v1', round, node, cell, digest, nonce]))))
}

export async function runAudit(round: number, seed: number, nodes: Node[], assigned: number[][], shards: Shard[]) {
  const random = rng(seed ^ 0x2d917)
  const ranked = nodes.map(node => ({ node, priority: random() })).sort((a, b) => a.priority - b.priority)
  return Promise.all(ranked.slice(0, 12).map(async ({ node }): Promise<AuditEvent> => {
    const choices = assigned[node.id]
    const cell = choices[Math.floor(random() * choices.length)]
    const nonce = Array.from({ length: 4 }, () => Math.floor(random() * 0x100000000).toString(16).padStart(8, '0')).join('')
    const expected = hex(await sha256(shards[cell]))
    if (node.status === 'offline' || node.status === 'delayed') {
      return { round, node: node.id, cell, outcome: 'offline', change: 0, commitment: '', nonce: null }
    }

    const honest = node.status === 'honest'
    const submittedDigest = honest ? expected : '0x' + '00'.repeat(32)
    const sealed = await commit(round, node.id, cell, submittedDigest, nonce)

    const revealed = honest ? shards[cell] : new Uint8Array(shards[cell].length)
    const revealedDigest = hex(await sha256(revealed))
    const replay = await commit(round, node.id, cell, revealedDigest, nonce)
    const passed = replay === sealed && revealedDigest === expected
    return { round, node: node.id, cell, outcome: passed ? 'rewarded' : 'slashed',
      change: passed ? AUDIT_REWARD : -AUDIT_SLASH, commitment: sealed, nonce }
  }))
}

export function incentiveReturns() {
  return { honest: AUDIT_REWARD - STORAGE_COST, dishonest: -AUDIT_SLASH }
}
