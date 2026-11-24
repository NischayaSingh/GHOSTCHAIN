import { writeFileSync } from 'node:fs'
import { buildPoseidon } from 'circomlibjs'
import { shardDigest } from '../packages/core/src/commit.ts'
import { ProductCode } from '../packages/core/src/erasure.ts'
import { BLOCK_BYTES, DEMO_BLOCKS, K } from '../packages/core/src/model.ts'
import { seededBytes } from '../packages/core/src/random.ts'

const poseidon = await buildPoseidon()
const hash = values => poseidon.F.toObject(poseidon(values))
const indices = [310, 998, 2501, 4010, 8191, 9216, 12217, 15518]
const position = 5
const square = new ProductCode(K).encode(seededBytes(BLOCK_BYTES, DEMO_BLOCKS[0]))
const digests = await Promise.all(indices.map(index => shardDigest(square[index]).then(bytes =>
  BigInt('0x' + Buffer.from(bytes).toString('hex')),
)))
const siblings = []
const direction = []
let level = digests.map(digest => hash([digest]))
let pointer = position
for (let depth = 0; depth < 3; depth++) {
  siblings.push(level[pointer ^ 1].toString())
  direction.push(pointer & 1)
  level = Array.from({ length: level.length / 2 }, (_, index) => hash(level.slice(2 * index, 2 * index + 2)))
  pointer >>>= 1
}
const root = level[0].toString()
writeFileSync(new URL('./build/input.json', import.meta.url), JSON.stringify({
  root, position, digest: digests[position].toString(), siblings, direction,
}, null, 2))
writeFileSync(new URL('../apps/web/public/zk/metadata.json', import.meta.url), JSON.stringify({
  sourceBlockSeed: DEMO_BLOCKS[0], coordinates: indices, position, root, protocol: 'Groth16', curve: 'BN254',
}, null, 2) + '\n')
