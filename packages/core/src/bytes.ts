const hexBytes = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'))

export function hex(data: Uint8Array): string {
  return '0x' + Array.from(data, byte => hexBytes[byte]).join('')
}

export function unhex(data: string): Uint8Array<ArrayBuffer> {
  if (!/^0x(?:[0-9a-f]{2})*$/i.test(data)) throw new Error('Invalid hexadecimal encoding')
  const result = new Uint8Array((data.length - 2) / 2)
  for (let i = 0; i < result.length; i++) result[i] = Number.parseInt(data.slice(2 + i * 2, 4 + i * 2), 16)
  return result
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const input = new Uint8Array(bytes)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input))
}
