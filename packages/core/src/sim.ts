import { repairMask } from './erasure.ts'
import { BLOCK_BYTES, CELLS, DEADLINE_MS, K, NODE_COUNT, SHARD_BYTES, WIDTH } from './model.ts'
import type { Controls, NodeStatus } from './model.ts'
import { mix32, rng } from './random.ts'

export interface Node {
  id: number
  status: NodeStatus
  slots: number
  delay: number
}

export interface Network {
  seed: number
  controls: Controls
  nodes: Node[]
}

export interface RoundMetrics {
  factor: number
  recovered: boolean
  reachable: number
  repaired: number
  storagePercent: number
  finalityMs: number | null
  placements: number
  dropout: number
  timeout: number
}

export interface Placement extends RoundMetrics {
  mask: Uint8Array
  arrival: Float32Array
  storage: Uint16Array
  assigned: number[][]
}

export function makeNetwork(seed: number, controls: Controls): Network {
  const random = rng(seed)
  const rank = Array.from({ length: NODE_COUNT }, (_, id) => ({ id, score: random() }))
    .sort((a, b) => a.score - b.score)
  const order = new Map(rank.map(({ id }, i) => [id, i]))
  return {
    seed,
    controls,
    nodes: Array.from({ length: NODE_COUNT }, (_, id) => {
      const faultRank = order.get(id)!
      const delay = 20 + random() * 58 + (0.2 + random() * 1.05) * controls.latency
      let status: NodeStatus = 'honest'
      if (faultRank < controls.faults) status = faultRank % 4 === 0 ? 'offline' : 'withholding'
      else if (delay + 20 > DEADLINE_MS) status = 'delayed'
      return { id, status, slots: 0, delay }
    }),
  }
}

function countableRecovery(arrival: Float32Array, threshold: number): boolean {
  return repairMask(Uint8Array.from(arrival, ms => Number(ms <= threshold)), K).recovered
}

export function place(network: Network, factor: number, keepAssignments = false, measureFinality = true): Placement {
  if (factor < 1 || factor > 4) throw new RangeError('Replication factor out of range')
  const { seed, nodes, controls } = network
  const arrival = new Float32Array(CELLS).fill(Infinity)
  const storage = new Uint16Array(NODE_COUNT)
  const assigned = keepAssignments ? Array.from({ length: NODE_COUNT }, () => new Array<number>()) : []
  const fraction = factor - Math.floor(factor)
  let dropout = 0
  let timeout = 0
  let placements = 0
  let reachable = 0
  for (let index = 0; index < CELLS; index++) {
    const cellSeed = mix32(seed ^ Math.imul(index + 1, 0x9e3779b9))
    const copies = Math.floor(factor) + Number(cellSeed / 0x100000000 < fraction)
    const quadrant = index < K * WIDTH && index % WIDTH < K
    const embargoed = quadrant && mix32(cellSeed ^ 0x5a93) % 100 < controls.withholding
    const chosen = [-1, -1, -1, -1]
    for (let copy = 0; copy < copies; copy++) {
      let id = mix32(cellSeed ^ Math.imul(copy + 1, 0x85ebca6b)) % NODE_COUNT
      while (chosen.includes(id)) id = (id + 1) % NODE_COUNT
      chosen[copy] = id
      const node = nodes[id]
      storage[id]++
      if (keepAssignments) assigned[id].push(index)
      placements++
      if (node.status === 'offline' || node.status === 'withholding') {
        dropout++
        continue
      }
      const delay = node.delay + mix32(cellSeed ^ Math.imul(id + 1, 0x27d4eb2d)) % 49
      if (delay > DEADLINE_MS) timeout++
      else if (!embargoed && delay < arrival[index]) arrival[index] = delay
    }
    if (arrival[index] <= DEADLINE_MS) reachable++
  }
  const mask = Uint8Array.from(arrival, ms => Number(ms <= DEADLINE_MS))
  const repair = repairMask(mask.slice(), K)
  let finalityMs: number | null = null
  if (repair.recovered && measureFinality) {
    let low = 0
    let high = DEADLINE_MS
    while (high - low > 4) {
      const middle = (low + high) / 2
      if (countableRecovery(arrival, middle)) high = middle
      else low = middle
    }
    finalityMs = Math.ceil(high)
  }
  return {
    factor, recovered: repair.recovered, reachable, repaired: repair.repairedCells, finalityMs,
    storagePercent: placements * SHARD_BYTES / NODE_COUNT / BLOCK_BYTES * 100,
    placements, dropout: dropout / placements, timeout: timeout / placements,
    assigned, mask, arrival, storage,
  }
}

export function summarize({ factor, recovered, reachable, repaired, storagePercent, finalityMs, placements, dropout, timeout }: Placement): RoundMetrics {
  return { factor, recovered, reachable, repaired, storagePercent, finalityMs, placements, dropout, timeout }
}
