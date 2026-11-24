import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DasContextJs } from '@crate-crypto/node-eth-kzg'
import { AUDIT_REWARD, AUDIT_SLASH, incentiveReturns, runAudit } from '@ghostchain/core/audit'
import { unhex } from '@ghostchain/core/bytes'
import { decodeProofBook, openShard, verifyOpenings } from '@ghostchain/core/commit'
import { detectionConfidence, sampleIndices, sessionBytes } from '@ghostchain/core/das'
import { ProductCode, repairMask } from '@ghostchain/core/erasure'
import { BLOCK_BYTES, DEMO_BLOCKS, K } from '@ghostchain/core/model'
import { rng, seededBytes } from '@ghostchain/core/random'
import { RedundancyController } from '@ghostchain/core/redundancy'
import { makeNetwork, place } from '@ghostchain/core/sim'

test('any k positions recover one Reed–Solomon line', () => {
  const code = new ProductCode(4)
  const line = code.encode(seededBytes(4 ** 2 * 20, 1)).slice(0, 8)
  for (let mask = 0; mask < 256; mask++) {
    const selected = line.map((shard, i) => mask & (1 << i) ? shard : undefined)
    if (selected.filter(Boolean).length === 4) assert.deepEqual(code.recoverLine(selected), line)
  }
})

test('2D reconstruction repairs scattered losses and one complete quadrant', () => {
  const code = new ProductCode(8)
  for (let seed = 0; seed < 64; seed++) {
    const block = seededBytes(8 ** 2 * 32, seed)
    const square = code.encode(block)
    const random = rng(seed)
    const missing = square.map((cell, index) => seed % 2 === 0
      ? (random() < 0.26 ? undefined : cell)
      : (index < 8 * 16 && index % 16 < 8 ? undefined : cell))
    assert.deepEqual(code.reconstruct(missing), block, `seed ${seed}`)
  }
})

test('a (k+1)×(k+1) erasure stops repair despite ample cells elsewhere', () => {
  const k = 8
  const mask = Uint8Array.from({ length: (2 * k) ** 2 }, (_, index) => Number(index >= (k + 1) * 2 * k || index % (2 * k) > k))
  assert(mask.reduce((a, b) => a + b, 0) > k ** 2)
  assert.equal(repairMask(mask, k).recovered, false)
})

test('simulated network and placement are deterministic and replicate to distinct nodes', () => {
  const controls = { faults: 50, withholding: 100, latency: 280 }
  const one = makeNetwork(77, controls)
  assert.deepEqual(one, makeNetwork(77, controls))
  const result = place(one, 3.25, true)
  assert.deepEqual(result, place(makeNetwork(77, controls), 3.25, true))
  assert.equal(result.assigned.flat().length, result.placements)
  assert(result.assigned.every(cells => new Set(cells).size === cells.length))
  assert.equal(result.mask[0], 0)
})

test('adaptive controller raises redundancy and reduces it with hysteresis', () => {
  const controller = new RedundancyController()
  for (let i = 0; i < 4; i++) controller.observe(.5, .3)
  assert.equal(controller.factor, 4)
  controller.observe(0, 0)
  controller.observe(0, 0)
  assert.equal(controller.factor, 4)
  controller.observe(0, 0)
  assert.equal(controller.factor, 3.75)
  for (let i = 0; i < 48; i++) controller.observe(0, 0)
  assert.equal(controller.factor, 1.25)
})

test('DAS uses unique coordinates and counts header, requests and response bytes', () => {
  const positions = sampleIndices(42, 60, 16384)
  assert.equal(new Set(positions).size, 60)
  assert.deepEqual(positions, sampleIndices(42, 60, 16384))
  assert.throws(() => sampleIndices(0, 17, 16))
  assert.equal((detectionConfidence(30) * 100).toFixed(4), '99.9821')
  assert(sessionBytes(30, 30, true) < BLOCK_BYTES * .01)
  assert(sessionBytes(32, 32, true) < BLOCK_BYTES * .01)
  assert(sessionBytes(60, 60, true) > BLOCK_BYTES * .01)
})

test('audit commits and reveals pay honest nodes and slash forged responses', async () => {
  const network = makeNetwork(8, { faults: 60, withholding: 0, latency: 0 })
  const assigned = network.nodes.map(() => [0])
  const shards = [seededBytes(64, 0)]
  const results = await runAudit(1, 7, network.nodes, assigned, shards)
  assert.deepEqual(results, await runAudit(1, 7, network.nodes, assigned, shards))
  assert(results.some(event => event.change === AUDIT_REWARD))
  assert(results.some(event => event.change === -AUDIT_SLASH))
  assert(results.filter(event => event.outcome !== 'offline').every(event => event.commitment.length === 66 && event.nonce?.length === 32))
  assert(incentiveReturns().honest > incentiveReturns().dishonest)
})

test('real KZG accepts honest data and rejects altered bytes, coordinates and witnesses', async () => {
  const seed = DEMO_BLOCKS[0]
  const raw = readFileSync(new URL(`../apps/web/public/blocks/${seed}.bin`, import.meta.url))
  const book = decodeProofBook(new Uint8Array(raw).buffer, seed)
  const kzg = DasContextJs.create({ usePrecomp: false })
  const adapter = {
    verifyCellKZGProofBatch(commitments: string[], indices: number[], cells: string[], proofs: string[]) {
      return kzg.verifyCellKzgProofBatch(commitments.map(unhex), indices, cells.map(unhex), proofs.map(unhex))
    },
  }
  const encoded = new ProductCode(K).encode(seededBytes(BLOCK_BYTES, seed))
  const openings = await Promise.all([0, 19, 1234, 5000, 16383].map(index => openShard(index, encoded, book)))
  const commitments = book.rows.map(row => row.commitment)
  assert.deepEqual((await verifyOpenings(adapter, commitments, openings)).accepted, [true, true, true, true, true])
  const modified = openings[0].data.slice()
  modified[0] ^= 1
  const sibling = openings[2].sibling.slice()
  sibling[2] ^= 1
  assert.deepEqual((await verifyOpenings(adapter, commitments, [
    { ...openings[0], data: modified }, openings[1], { ...openings[2], sibling }, { ...openings[3], index: 5130 },
  ])).accepted, [false, true, false, false])

  const random = rng(101)
  const tampered = await Promise.all(sampleIndices(2349, 12, 16384).map(async index => {
    const opening = await openShard(index, encoded, book)
    const data = opening.data.slice()
    data[Math.floor(random() * data.length)] ^= 1 << Math.floor(random() * 8)
    return { ...opening, data }
  }))
  assert((await verifyOpenings(adapter, commitments, tampered)).accepted.every(accepted => !accepted))
})

test('arbitrary binary blocks recover after many random erasure orders', () => {
  const k = 7
  const code = new ProductCode(k)
  const width = 2 * k
  for (let seed = 0; seed < 96; seed++) {
    const original = seededBytes(k ** 2 * (5 + seed % 17), mixSeed(seed))
    const square = code.encode(original)
    const missing = new Set(sampleIndices(mixSeed(seed + 5), (k + 1) ** 2 - 1, width ** 2))
    assert.deepEqual(code.reconstruct(square.map((cell, index) => missing.has(index) ? undefined : cell)), original, `seed ${seed}`)
  }
})

function mixSeed(seed: number) {
  return Math.imul(seed + 1, 0x9e3779b9)
}

test('controller stays bounded and quantized under randomized fault and timeout sequences', () => {
  const random = rng(817)
  for (let trial = 0; trial < 48; trial++) {
    const controller = new RedundancyController()
    let previous = controller.factor
    for (let round = 0; round < 80; round++) {
      const factor = controller.observe(random(), random())
      assert(factor >= 1.25 && factor <= 4)
      assert(Number.isInteger(factor * 4))
      assert(factor >= previous - .25)
      previous = factor
    }
  }
})
