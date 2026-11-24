import { COORDINATE_BYTES, HEADER_BYTES, SHARD_RESPONSE_BYTES } from './model.ts'
import { rng } from './random.ts'

export function sampleIndices(seed: number, count: number, population: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > population) throw new RangeError('Invalid sample size')
  const random = rng(seed)
  const selected = new Set<number>()
  for (let index = population - count; index < population; index++) {
    const candidate = Math.floor(random() * (index + 1))
    selected.add(selected.has(candidate) ? index : candidate)
  }
  return [...selected]
}

export function detectionConfidence(count: number, withheldFraction = 0.25): number {
  if (count < 0 || withheldFraction < 0 || withheldFraction > 1) throw new RangeError('Invalid confidence parameters')
  return 1 - (1 - withheldFraction) ** count
}

export function sessionBytes(requests: number, responses: number, includeHeader: boolean) {
  return Number(includeHeader) * HEADER_BYTES + requests * COORDINATE_BYTES + responses * SHARD_RESPONSE_BYTES
}
