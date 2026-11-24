export function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad)
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97)
  return (value ^ (value >>> 15)) >>> 0
}

export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x9e3779b9) | 0
    return mix32(seed) / 0x100000000
  }
}

export function seededBytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(length)
  const random = rng(seed)
  for (let i = 0; i < data.length; i += 4) {
    const word = Math.floor(random() * 0x100000000)
    data[i] = word
    data[i + 1] = word >>> 8
    data[i + 2] = word >>> 16
    data[i + 3] = word >>> 24
  }
  return data
}
