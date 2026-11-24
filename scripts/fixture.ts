import { mkdirSync, writeFileSync } from 'node:fs'
import { DasContextJs } from '@crate-crypto/node-eth-kzg'
import { ProductCode } from '@ghostchain/core/erasure'
import { encodeProofBook, KZG_INPUT_CELLS, rowBlob } from '@ghostchain/core/commit'
import type { RowProofs } from '@ghostchain/core/commit'
import { BLOCK_BYTES, DEMO_BLOCKS, K, WIDTH } from '@ghostchain/core/model'
import { seededBytes } from '@ghostchain/core/random'

const directory = new URL('../apps/web/public/blocks/', import.meta.url)
mkdirSync(directory, { recursive: true })
const kzg = DasContextJs.create({ usePrecomp: false })
const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : DEMO_BLOCKS
for (const seed of seeds) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Expected an unsigned 32-bit seed')
  const square = new ProductCode(K).encode(seededBytes(BLOCK_BYTES, seed))
  const rows: RowProofs[] = []
  const started = performance.now()
  for (let row = 0; row < WIDTH; row++) {
    const blob = await rowBlob(square.slice(row * WIDTH, (row + 1) * WIDTH))
    const commitment = kzg.blobToKzgCommitment(blob)
    const { proofs } = kzg.computeCellsAndKzgProofs(blob)
    rows.push({ commitment, proofs: proofs.slice(0, KZG_INPUT_CELLS) })
    if ((row + 1) % 32 === 0) console.log(`Block ${seed}: ${row + 1}/${WIDTH} rows in ${((performance.now() - started) / 1000).toFixed(1)}s`)
  }
  writeFileSync(new URL(`${seed}.bin`, directory), encodeProofBook({ seed, rows }))
}
