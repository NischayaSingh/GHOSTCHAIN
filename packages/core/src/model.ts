export const K = 64
export const WIDTH = K * 2
export const CELLS = WIDTH ** 2
export const SHARD_BYTES = 1536
export const BLOCK_BYTES = K ** 2 * SHARD_BYTES
export const NODE_COUNT = 100
export const DEADLINE_MS = 300
export const COMMITMENT_BYTES = 48
export const OPENING_BYTES = 48
export const DIGEST_BYTES = 32
export const HEADER_BYTES = 8 + WIDTH * COMMITMENT_BYTES
export const COORDINATE_BYTES = 2
export const SHARD_RESPONSE_BYTES = COORDINATE_BYTES + SHARD_BYTES + DIGEST_BYTES + OPENING_BYTES
export const DEMO_BLOCKS = [20261120, 20261121, 20261122] as const

export interface Controls {
  faults: number
  withholding: number
  latency: number
}

export const DEFAULT_CONTROLS: Controls = { faults: 10, withholding: 0, latency: 0 }
export type Strategy = 'adaptive' | 'static'
export type NodeStatus = 'honest' | 'offline' | 'withholding' | 'delayed'
