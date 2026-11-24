export type Shard = Uint8Array
export type Square = Array<Shard | undefined>

const products = new Uint8Array(256 * 256)
const inverses = new Uint8Array(256)
for (let a = 1; a < 256; a++) {
  for (let b = 1; b < 256; b++) {
    let left = a
    let right = b
    let result = 0
    while (right) {
      if (right & 1) result ^= left
      left = (left << 1) ^ ((left & 128) ? 0x11d : 0)
      right >>>= 1
    }
    products[a * 256 + b] = result
    if (result === 1) inverses[a] = b
  }
}

function matrixInverse(matrix: Uint8Array[]): Uint8Array[] {
  const size = matrix.length
  const rows = matrix.map((row, i) => {
    const augmented = new Uint8Array(2 * size)
    augmented.set(row)
    augmented[size + i] = 1
    return augmented
  })
  for (let column = 0; column < size; column++) {
    const pivot = rows.findIndex((row, i) => i >= column && row[column] !== 0)
    if (pivot < 0) throw new Error('Singular Reed–Solomon matrix')
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    const row = rows[column]
    const scale = inverses[row[column]] * 256
    for (let j = column; j < 2 * size; j++) row[j] = products[scale + row[j]]
    for (let i = 0; i < size; i++) {
      if (i === column || rows[i][column] === 0) continue
      const target = rows[i]
      const factor = target[column] * 256
      for (let j = column; j < 2 * size; j++) target[j] ^= products[factor + row[j]]
    }
  }
  return rows.map(row => row.slice(size))
}

function combine(inputs: Shard[], coefficients: Uint8Array): Shard {
  const output = new Uint8Array(inputs[0].length)
  for (let i = 0; i < inputs.length; i++) {
    const factor = coefficients[i] * 256
    if (factor === 0) continue
    const input = inputs[i]
    for (let j = 0; j < output.length; j++) output[j] ^= products[factor + input[j]]
  }
  return output
}

export class ProductCode {
  readonly width: number
  private readonly generator: Uint8Array[]
  private readonly cache = new Map<string, Uint8Array[]>()

  constructor(readonly k: number) {
    if (!Number.isInteger(k) || k < 1 || k > 128) throw new RangeError('Expected 1 ≤ k ≤ 128')
    this.width = 2 * k
    this.generator = Array.from({ length: this.width }, (_, row) =>
      Uint8Array.from({ length: k }, (_, col) => row < k ? Number(row === col) : inverses[row ^ col]),
    )
  }

  encode(block: Uint8Array): Shard[] {
    const { k, width } = this
    if (!block.length || block.length % (k * k)) throw new RangeError('Use equal, nonempty source shards')
    const shardSize = block.length / (k * k)
    const square = new Array<Shard>(width * width)
    for (let row = 0; row < k; row++) {
      const sources = Array.from({ length: k }, (_, col) => {
        const offset = (row * k + col) * shardSize
        return block.slice(offset, offset + shardSize)
      })
      for (let col = 0; col < width; col++) {
        square[row * width + col] = col < k ? sources[col] : combine(sources, this.generator[col])
      }
    }
    for (let col = 0; col < width; col++) {
      const sources = Array.from({ length: k }, (_, row) => square[row * width + col])
      for (let row = k; row < width; row++) square[row * width + col] = combine(sources, this.generator[row])
    }
    return square
  }

  recoverLine(line: Square): Square {
    if (line.length !== this.width) throw new RangeError('Invalid line width')
    const valid = line.flatMap((shard, index) => shard ? [index] : [])
    if (valid.length < this.k || valid.length === this.width) return line.slice()
    const indices = valid.slice(0, this.k)
    const key = indices.join(',')
    let inverse = this.cache.get(key)
    if (!inverse) {
      inverse = matrixInverse(indices.map(index => this.generator[index]))
      if (this.cache.size >= 512) this.cache.clear()
      this.cache.set(key, inverse)
    }
    const inputs = indices.map(index => line[index]!)
    const result = line.slice()
    for (let index = 0; index < this.width; index++) {
      if (result[index]) continue
      const row = this.generator[index]
      const coefficients = index < this.k ? inverse[index] : new Uint8Array(this.k)
      if (index >= this.k) {
        for (let j = 0; j < this.k; j++) {
          const factor = row[j] * 256
          for (let col = 0; col < this.k; col++) coefficients[col] ^= products[factor + inverse[j][col]]
        }
      }
      result[index] = combine(inputs, coefficients)
    }
    return result
  }

  reconstruct(shards: Square): Uint8Array | null {
    if (shards.length !== this.width ** 2) throw new RangeError('Invalid square size')
    const present = Uint8Array.from(shards, shard => Number(Boolean(shard)))
    const result = shards.slice()
    const outcome = repairMask(present, this.k, indices => {
      const recovered = this.recoverLine(indices.map(index => result[index]))
      indices.forEach((index, offset) => { result[index] = recovered[offset] })
    })
    if (!outcome.recovered) return null
    const shardSize = result[0]!.length
    const block = new Uint8Array(this.k ** 2 * shardSize)
    for (let row = 0; row < this.k; row++) {
      for (let col = 0; col < this.k; col++) {
        block.set(result[row * this.width + col]!, (row * this.k + col) * shardSize)
      }
    }
    return block
  }
}

export function repairMask(mask: Uint8Array, k: number, onRepair?: (indices: number[]) => void) {
  const width = 2 * k
  if (mask.length !== width ** 2) throw new RangeError('Invalid availability mask')
  const rows = new Uint16Array(width)
  const cols = new Uint16Array(width)
  let missingSources = 0
  for (let row = 0, index = 0; row < width; row++) {
    for (let col = 0; col < width; col++, index++) {
      if (mask[index]) {
        rows[row]++
        cols[col]++
      } else if (row < k && col < k) missingSources++
    }
  }
  const queue: number[] = []
  for (let i = 0; i < width; i++) {
    if (rows[i] >= k && rows[i] < width) queue.push(i)
    if (cols[i] >= k && cols[i] < width) queue.push(i + width)
  }
  let repairedCells = 0
  let repairedLines = 0
  for (let head = 0; head < queue.length && missingSources; head++) {
    const line = queue[head]
    const isRow = line < width
    const fixed = line % width
    if ((isRow ? rows[fixed] : cols[fixed]) === width) continue
    const indices = onRepair ? new Array<number>(width) : undefined
    for (let i = 0; i < width; i++) {
      const row = isRow ? fixed : i
      const col = isRow ? i : fixed
      const index = row * width + col
      if (indices) indices[i] = index
      if (mask[index]) continue
      mask[index] = 1
      rows[row]++
      cols[col]++
      if (isRow && cols[col] === k) queue.push(col + width)
      if (!isRow && rows[row] === k) queue.push(row)
      if (row < k && col < k) missingSources--
      repairedCells++
    }
    if (indices) onRepair!(indices)
    repairedLines++
  }
  return { recovered: missingSources === 0, repairedCells, repairedLines, missingSources }
}
