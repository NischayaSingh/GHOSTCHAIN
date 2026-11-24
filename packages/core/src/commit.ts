import { hex, sha256 } from './bytes.ts'
import type { Shard } from './erasure.ts'
import { BLOCK_BYTES, COMMITMENT_BYTES, DIGEST_BYTES, OPENING_BYTES, SHARD_BYTES, WIDTH } from './model.ts'

export const KZG_CELL_BYTES = 2048
export const KZG_INPUT_CELLS = WIDTH / 2
const ROW_BYTES = COMMITMENT_BYTES + KZG_INPUT_CELLS * OPENING_BYTES
const FORMAT_BYTES = 8

export interface RowProofs {
  commitment: Uint8Array
  proofs: Uint8Array[]
}

export interface ProofBook {
  seed: number
  rows: RowProofs[]
}

export interface Opening {
  index: number
  data: Shard
  sibling: Uint8Array
  proof: Uint8Array
}

export interface KzgVerifier {
  verifyCellKZGProofBatch(commitments: string[], indices: number[], cells: string[], proofs: string[], count: number): boolean
}

export async function shardDigest(shard: Shard): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await sha256(shard)
  // Preserve 248 bits. A leading zero is canonical in the BLS12-381 scalar field.
  digest.copyWithin(1, 0, 31)
  digest[0] = 0
  return digest
}

export function packCell(left: Uint8Array, right: Uint8Array) {
  const cell = new Uint8Array(KZG_CELL_BYTES)
  cell.set(left, 0)
  cell.set(right, DIGEST_BYTES)
  return cell
}

export async function rowBlob(shards: Shard[]) {
  if (shards.length !== WIDTH) throw new RangeError('A row must contain 128 shards')
  const digests = await Promise.all(shards.map(shardDigest))
  const blob = new Uint8Array(KZG_INPUT_CELLS * KZG_CELL_BYTES)
  for (let group = 0; group < KZG_INPUT_CELLS; group++) {
    blob.set(packCell(digests[group * 2], digests[group * 2 + 1]), group * KZG_CELL_BYTES)
  }
  return blob
}

export function encodeProofBook(book: ProofBook) {
  const bytes = new Uint8Array(FORMAT_BYTES + WIDTH * ROW_BYTES)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, book.seed)
  view.setUint32(4, BLOCK_BYTES)
  book.rows.forEach(({ commitment, proofs }, row) => {
    const offset = FORMAT_BYTES + row * ROW_BYTES
    bytes.set(commitment, offset)
    proofs.forEach((proof, index) => bytes.set(proof, offset + COMMITMENT_BYTES + index * OPENING_BYTES))
  })
  return bytes
}

export function decodeProofBook(buffer: ArrayBuffer, expectedSeed: number): ProofBook {
  if (buffer.byteLength !== FORMAT_BYTES + WIDTH * ROW_BYTES) throw new Error('Unexpected proof book length')
  const view = new DataView(buffer)
  if (view.getUint32(0) !== expectedSeed || view.getUint32(4) !== BLOCK_BYTES) throw new Error('Wrong proof book header')
  const bytes = new Uint8Array(buffer)
  return {
    seed: expectedSeed,
    rows: Array.from({ length: WIDTH }, (_, row) => {
      const offset = FORMAT_BYTES + row * ROW_BYTES
      return {
        commitment: bytes.subarray(offset, offset + COMMITMENT_BYTES),
        proofs: Array.from({ length: KZG_INPUT_CELLS }, (_, index) => {
          const start = offset + COMMITMENT_BYTES + index * OPENING_BYTES
          return bytes.subarray(start, start + OPENING_BYTES)
        }),
      }
    }),
  }
}

export async function openShard(index: number, shards: Shard[], book: ProofBook): Promise<Opening> {
  const row = Math.floor(index / WIDTH)
  const col = index % WIDTH
  return {
    index, data: shards[index], sibling: await shardDigest(shards[index ^ 1]),
    proof: book.rows[row].proofs[col >>> 1],
  }
}

export async function verifyOpenings(verifier: KzgVerifier, commitments: Uint8Array[], openings: Opening[]) {
  const started = performance.now()
  const valid = await Promise.all(openings.map(async opening => {
    if (opening.index < 0 || opening.index >= WIDTH ** 2 || !Number.isInteger(opening.index)
      || opening.data.length !== SHARD_BYTES || opening.sibling.length !== DIGEST_BYTES || opening.proof.length !== OPENING_BYTES) return null
    const col = opening.index % WIDTH
    const digest = await shardDigest(opening.data)
    const packed = col % 2 === 0 ? packCell(digest, opening.sibling) : packCell(opening.sibling, digest)
    return {
      commitment: hex(commitments[Math.floor(opening.index / WIDTH)]),
      index: col >>> 1,
      cell: hex(packed),
      proof: hex(opening.proof),
    }
  }))
  const verify = (first: number, last: number): boolean => {
    const batch = valid.slice(first, last)
    if (batch.some(item => !item)) return false
    const items = batch as NonNullable<(typeof valid)[number]>[]
    try {
      return verifier.verifyCellKZGProofBatch(
        items.map(item => item.commitment), items.map(item => item.index),
        items.map(item => item.cell), items.map(item => item.proof), items.length,
      )
    } catch {
      return false
    }
  }
  const accepted = Array<boolean>(openings.length).fill(false)
  const visit = (first: number, last: number) => {
    if (verify(first, last)) accepted.fill(true, first, last)
    else if (last - first > 1) {
      const middle = Math.floor((first + last) / 2)
      visit(first, middle)
      visit(middle, last)
    }
  }
  if (openings.length) visit(0, openings.length)
  return { accepted, ms: performance.now() - started }
}
