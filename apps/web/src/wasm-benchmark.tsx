import { useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { CELLS } from '@ghostchain/core/model'
import { sampleIndices } from '@ghostchain/core/das'
import type { OpeningPacket, VerifyRequest, VerifyResult } from './protocol'
import type { WorkerRpc } from './rpc'
import type { NetworkApi } from './network-api'
import { PanelTitle } from './ui'

interface Row {
  samples: number
  repetitions: number
  medianMs: number
  p95Ms: number
  timings: number[]
}
interface Measurement {
  browser: string
  rows: Row[]
}

export function WasmBenchmark({ network, verifier, ready }: {
  network: NetworkApi, verifier: WorkerRpc<VerifyRequest>, ready: boolean,
}) {
  const [result, setResult] = useState<Measurement>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function measure() {
    setBusy(true)
    setError('')
    setResult(undefined)
    try {
      const rows: Row[] = []
      const repetitions = 12
      for (const samples of [16, 24, 30]) {
        const timings: number[] = []
        for (let i = 0; i <= repetitions; i++) {
          const indices = sampleIndices(991 + 7853 * i, samples, CELLS)
          const { commitments, openings } = await network.call<OpeningPacket>({ kind: 'openings', indices, fixture: true })
          const result = await verifier.call<VerifyResult>({ kind: 'verify', commitments, openings })
          if (result.accepted.length !== samples || result.accepted.some(value => !value)) throw new Error('A valid fixture opening was rejected')
          if (i) timings.push(Number(result.ms.toFixed(2)))
        }
        const sorted = timings.toSorted((a, b) => a - b)
        rows.push({ samples, repetitions, medianMs: (sorted[5] + sorted[6]) / 2, p95Ms: sorted[Math.ceil(.95 * repetitions) - 1], timings })
      }
      setResult({ browser: navigator.userAgent, rows })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  function save() {
    if (!result) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2) + '\n'], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'browser-wasm.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <article className="panel results-table wasm-benchmark">
    <PanelTitle icon={<Fingerprint size={20} />} title="Browser verification timing" detail="Measure 12 honest batches per sample count on this device. Fixture delivery and WASM startup are outside the timer."
      action={<button className="button secondary" disabled={!ready || busy} onClick={() => void measure()}>{busy ? 'Measuring…' : 'Measure WASM'}</button>} />
    <p className="note">On the original Chromium device, median 30-cell verification took 80.7–105.8 ms across two runs. The target was 50 ms. With a fixed 25% withheld fraction, 16 clean samples give about 99.0% detection confidence.</p>
    {error && <p className="red" role="alert">{error}</p>}
    {result && <>
      <div className="table-scroll"><table><thead><tr><th>Samples</th><th>Repetitions</th><th>Median</th><th>p95</th></tr></thead>
        <tbody>{result.rows.map(row => <tr key={row.samples}><td>{row.samples}</td><td>{row.repetitions}</td><td>{row.medianMs.toFixed(2)} ms</td><td>{row.p95Ms.toFixed(2)} ms</td></tr>)}</tbody></table></div>
      <button className="button secondary compact" onClick={save}>Download browser timing JSON</button>
      <details className="measurements"><summary>Raw timing JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
    </>}
  </article>
}
