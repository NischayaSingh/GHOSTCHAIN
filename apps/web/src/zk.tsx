import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { PanelTitle } from './ui'

export function ZkExample() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [good, setGood] = useState(false)
  async function verify(tamper: boolean) {
    setBusy(true)
    setResult('')
    try {
      const [{ groth16 }, key, inputs, proof] = await Promise.all([
        import('snarkjs'),
        ...['verification_key', 'public', 'proof'].map(async file => {
          const response = await fetch(`${import.meta.env.BASE_URL}zk/${file}.json`)
          if (!response.ok) throw new Error('ZK fixture failed to load')
          return response.json()
        }),
      ])
      if (tamper) inputs[0] = (BigInt(inputs[0]) + 1n).toString()
      const accepted = await groth16.verify(key, inputs, proof)
      setGood(accepted === !tamper)
      setResult(accepted ? 'Membership proof verified' : 'Proof rejected for the supplied root')
    } catch (error) {
      setGood(false)
      setResult(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }

  return <article className="panel zk-panel">
    <PanelTitle icon={<ShieldCheck size={20} />} title="Zero-knowledge membership" detail="Verify a Groth16 proof for one hidden cell digest in a separate eight-cell Poseidon tree." />
    <div className="actions">
      <button className="button secondary" disabled={busy} onClick={() => void verify(false)}>Verify example proof</button>
      <button className="button secondary" disabled={busy} onClick={() => void verify(true)}>Test changed root</button>
      <span aria-live="polite" className={good ? 'mint' : 'red'}>{result}</span>
    </div>
  </article>
}
