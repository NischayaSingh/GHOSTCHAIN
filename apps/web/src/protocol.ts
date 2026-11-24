import type { AuditEvent } from '@ghostchain/core/audit'
import type { Opening } from '@ghostchain/core/commit'
import type { Controls } from '@ghostchain/core/model'
import type { Node, RoundMetrics } from '@ghostchain/core/sim'

export interface Snapshot {
  seed: number
  height: number
  round: number
  blockRounds: number
  recoveredRounds: number
  controls: Controls
  blockId: string
  sourceBytes?: number
  nodes: Node[]
  adaptive: RoundMetrics
  baseline: RoundMetrics
  byteVerified: boolean
  ledger: number[]
  audits: AuditEvent[]
}

export type NetworkRequest =
  | { kind: 'tick', controls: Controls }
  | { kind: 'publish', controls: Controls, input?: Uint8Array }
  | { kind: 'reset', controls: Controls, seed: number }
  | { kind: 'audit' }
  | { kind: 'openings', indices: number[], fixture?: boolean }

export interface OpeningPacket {
  httpBodyBytes?: number
  height: number
  blockId: string
  commitments: Uint8Array[]
  openings: Opening[]
}

export type VerifyRequest =
  | { kind: 'warmup' }
  | { kind: 'verify', commitments: Uint8Array[], openings: Opening[] }

export interface VerifyResult {
  accepted: boolean[]
  ms: number
}

export interface WorkerMessage<T> {
  id: number
  request: T
}

export interface WorkerReply {
  id: number
  value?: unknown
  error?: string
}
