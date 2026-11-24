import { readFile } from 'node:fs/promises'
import { runAudit } from '@ghostchain/core/audit'
import type { AuditEvent } from '@ghostchain/core/audit'
import { hex, sameBytes, sha256, unhex } from '@ghostchain/core/bytes'
import { decodeProofBook, KZG_INPUT_CELLS, openShard, rowBlob } from '@ghostchain/core/commit'
import type { ProofBook } from '@ghostchain/core/commit'
import { ProductCode } from '@ghostchain/core/erasure'
import type { Shard } from '@ghostchain/core/erasure'
import { BLOCK_BYTES, CELLS, DEMO_BLOCKS, K, NODE_COUNT, WIDTH } from '@ghostchain/core/model'
import type { Controls } from '@ghostchain/core/model'
import { mix32, seededBytes } from '@ghostchain/core/random'
import { RedundancyController } from '@ghostchain/core/redundancy'
import { makeNetwork, place, summarize } from '@ghostchain/core/sim'
import type { Network, Placement } from '@ghostchain/core/sim'
import type { NetworkRequest, OpeningPacket, Snapshot } from '../web/src/protocol.ts'

const code = new ProductCode(K)
type Producer = Awaited<ReturnType<typeof import('kzg-wasm')['loadKZG']>>
let producer: Promise<Producer> | undefined

function getProducer() {
  producer ??= import('kzg-wasm').then(module => module.loadKZG()).catch(error => {
    producer = undefined
    throw error
  })
  return producer
}

export function createSimulation(assetRoot: URL) {
  let custom: { bytes: number, rowBlobs: string[] } | undefined
  let recoveredRounds = 0
  let blockRounds = 0

  async function produceInput(input: Uint8Array) {
    if (!input.length || input.length > BLOCK_BYTES - 4) throw new Error('Input must fit in one coded block')
    const nextData = new Uint8Array(BLOCK_BYTES)
    new DataView(nextData.buffer).setUint32(0, input.length)
    nextData.set(input, 4)
    const nextShards = code.encode(nextData)
    const kzg = await getProducer()
    // Padding often creates identical rows. Reuse their commitment and their lazy proof cache.
    const distinct = new Map<string, { entry: ProofBook['rows'][number], blob: string }>()
    const rowBlobs: string[] = []
    const rows: ProofBook['rows'] = []
    for (let row = 0; row < WIDTH; row++) {
      const blob = await rowBlob(nextShards.slice(row * WIDTH, (row + 1) * WIDTH))
      const key = hex(await sha256(blob))
      let cached = distinct.get(key)
      if (!cached) {
        const serialized = hex(blob)
        cached = { entry: { commitment: unhex(kzg.blobToKZGCommitment(serialized)), proofs: [] }, blob: serialized }
        distinct.set(key, cached)
      }
      rowBlobs.push(cached.blob)
      rows.push(cached.entry)
    }
    const nextId = await commitmentId(rows)
    data = nextData
    shards = nextShards
    book = { seed: 0, rows }
    blockId = nextId
    custom = { bytes: input.length, rowBlobs }
  }

  async function commitmentId(rows: ProofBook['rows']) {
    return hex(await sha256(Uint8Array.from(rows.flatMap(row => Array.from(row.commitment)))))
  }

  async function openAvailable(indices: number[], fixture?: boolean) {
    const available = indices.filter(index => fixture || lastPlacement.mask[index])
    if (custom) {
      const kzg = await getProducer()
      for (const index of available) {
        const row = Math.floor(index / WIDTH)
        if (!book.rows[row].proofs.length) {
          book.rows[row].proofs = kzg.computeCellsAndKZGProofs(custom.rowBlobs[row])
            .proofs.slice(0, KZG_INPUT_CELLS).map(unhex)
        }
      }
    }
    return Promise.all(available.map(index => openShard(index, shards, book)))
  }

  let data: Uint8Array
  let shards: Shard[]
  let book: ProofBook
  let blockId = ''
  let height = 1
  let round = 0
  let seed = DEMO_BLOCKS[0] as number
  let controller = new RedundancyController()
  let lastNetwork: Network
  let lastPlacement: Placement
  let latest: Snapshot
  let ledger = Array<number>(NODE_COUNT).fill(0)
  let audits: AuditEvent[] = []

  async function produce() {
    const fixtureSeed = DEMO_BLOCKS[(height - 1) % DEMO_BLOCKS.length]
    const fixture = await readFile(new URL(`blocks/${fixtureSeed}.bin`, assetRoot))
    const nextBook = decodeProofBook(Uint8Array.from(fixture).buffer, fixtureSeed)
    const nextData = seededBytes(BLOCK_BYTES, fixtureSeed)
    const nextShards = code.encode(nextData)
    blockId = await commitmentId(nextBook.rows)
    custom = undefined
    book = nextBook
    shards = nextShards
    data = nextData
  }

  async function audit() {
    const events = await runAudit(round, lastNetwork.seed, lastNetwork.nodes, lastPlacement.assigned, shards)
    for (const event of events) ledger[event.node] += event.change
    audits = [...events, ...audits].slice(0, 96)
  }

  async function tick(controls: Controls): Promise<Snapshot> {
    round++
    lastNetwork = makeNetwork(mix32(seed ^ Math.imul(round, 0x85ebca6b)), controls)
    const baseline = place(lastNetwork, 2)
    const initial = place(lastNetwork, controller.factor, false, false)
    const factor = controller.observe(initial.dropout, initial.timeout)
    lastPlacement = place(lastNetwork, factor, true)
    const decoded = lastPlacement.recovered
      ? code.reconstruct(shards.map((shard, index) => lastPlacement.mask[index] ? shard : undefined))
      : null
    const byteVerified = decoded !== null && sameBytes(decoded, data)
    blockRounds++
    if (byteVerified) recoveredRounds++
    if (round % 4 === 0) await audit()
    latest = {
      seed, height, round, blockRounds, recoveredRounds, controls, blockId, byteVerified, sourceBytes: custom?.bytes,
      nodes: lastNetwork.nodes.map(node => ({ ...node, slots: lastPlacement.storage[node.id] })),
      adaptive: { ...summarize(lastPlacement), recovered: byteVerified },
      baseline: summarize(baseline), ledger: ledger.slice(), audits: audits.slice(),
    }
    return latest
  }

  async function handle(request: NetworkRequest): Promise<Snapshot | OpeningPacket> {
    switch (request.kind) {
      case 'reset':
        height = 1
        round = 0
        controller = new RedundancyController()
        ledger = Array<number>(NODE_COUNT).fill(0)
        audits = []
        if (custom || !book || book.seed !== DEMO_BLOCKS[0]) await produce()
        seed = request.seed
        blockRounds = recoveredRounds = 0
        return tick(request.controls)
      case 'publish':
        height++
        try {
          if (request.input) await produceInput(request.input)
          else await produce()
        } catch (error) {
          height--
          throw error
        }
        blockRounds = recoveredRounds = 0
        return tick(request.controls)
      case 'tick':
        if (!book) await produce()
        return tick(request.controls)
      case 'audit':
        if (!lastNetwork) throw new Error('Produce a block before running an audit')
        if (latest.audits[0]?.round === round) await tick(latest.controls)
        if (latest.audits[0]?.round !== round) await audit()
        latest = { ...latest, ledger: ledger.slice(), audits: audits.slice() }
        return latest
      case 'openings':
        if (!book || !lastPlacement) throw new Error('The first block is still loading')
        if (request.indices.length > 60 || !request.indices.every(i => Number.isInteger(i) && i >= 0 && i < CELLS)) throw new Error('Invalid sampling request')
        return {
          height, blockId, commitments: book.rows.map(row => row.commitment),
          openings: await openAvailable(request.indices, request.fixture),
        }
    }
  }

  return handle
}
