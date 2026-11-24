import { useState } from 'react'
import { BLOCK_BYTES, CELLS } from '@ghostchain/core/model'
import type { Snapshot } from './protocol'

async function ask(body: object) {
  const response = await fetch('/api/assist', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw new Error('AI is unavailable on this host. Run the app with a configured AI server.')
  }
  const result = await response.json() as { text?: string, error?: string }
  if (!response.ok || !result.text) throw new Error(result.error ?? 'AI returned no text')
  return result.text
}

export function InputModes({ snapshot, busy, publish }: {
  snapshot?: Snapshot, busy: boolean, publish: (input: Uint8Array) => void,
}) {
  const [mode, setMode] = useState<'analyze' | 'generate'>('analyze')
  const [text, setText] = useState('')
  const [prompt, setPrompt] = useState('')
  const [file, setFile] = useState<File>()
  const [fileKey, setFileKey] = useState(0)
  const [generated, setGenerated] = useState('')
  const [explanation, setExplanation] = useState<{ round: number, text: string }>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const encoder = new TextEncoder()

  async function perform(action: () => Promise<void>) {
    setError('')
    setWorking(true)
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setWorking(false) }
  }

  return <details className="input-modes">
    <summary>Use my data or AI</summary>
    <form onSubmit={event => {
      event.preventDefault()
      void perform(async () => {
        if (mode === 'generate') {
          setGenerated('')
          const answer = await ask({ mode: 'generate', prompt })
          setGenerated(answer)
          publish(encoder.encode(answer))
          return
        }
        if (file && file.size > BLOCK_BYTES - 4) throw new Error('The file is too large for one block.')
        const data = file ? new Uint8Array(await file.arrayBuffer()) : encoder.encode(text)
        if (!data.length || data.length > BLOCK_BYTES - 4) throw new Error('Enter data that fits in one block (6 MiB minus 4 bytes).')
        setExplanation(undefined)
        publish(data)
      })
    }}>
      <label>Input mode
        <select aria-label="Input mode" value={mode} disabled={working} onChange={event => {
          setMode(event.target.value === 'generate' ? 'generate' : 'analyze')
          setError('')
        }}>
          <option value="analyze">Analyze my data</option><option value="generate">Generate with AI</option>
        </select>
      </label>
      {mode === 'analyze' ? <>
        <label>Text<textarea value={text} disabled={!!file} onChange={event => setText(event.target.value)} /></label>
        <label>Or choose a file<input key={fileKey} type="file" onChange={event => setFile(event.target.files?.[0])} /></label>
        {file && <div className="actions"><span>{file.name}</span><button type="button" className="button ghost"
          onClick={() => { setFile(undefined); setFileKey(key => key + 1) }}>Clear file</button></div>}
        <p className="note">Your text or file stays in this browser. AI explanations use recovery metrics only.</p>
      </> : <>
        <label>Prompt<textarea value={prompt} maxLength={6000} onChange={event => setPrompt(event.target.value)} /></label>
        <p className="note">Your prompt goes to the AI service. Its response becomes the block payload.</p>
      </>}
      <p className="note">AI actions require a configured local server.</p>
      <div className="actions">
        <button className="button secondary" disabled={busy || working || (mode === 'analyze' ? !file && !text : !prompt.trim())}>
          {working ? 'Working…' : mode === 'analyze' ? 'Test my data' : 'Generate and test'}
        </button>
        {mode === 'analyze' && <button type="button" className="button secondary" disabled={!snapshot?.sourceBytes || busy || working}
          onClick={() => {
            if (!snapshot) return
            void perform(async () => {
              setExplanation(undefined)
              const text = await ask({ mode: 'explain', metrics: {
                round: snapshot.round, recovered: snapshot.byteVerified,
                reachablePercent: snapshot.adaptive.reachable / CELLS * 100,
                storagePercent: snapshot.adaptive.storagePercent, replication: snapshot.adaptive.factor,
                faults: snapshot.controls.faults, withholding: snapshot.controls.withholding, latencyMs: snapshot.controls.latency,
              } })
              setExplanation({ round: snapshot.round, text })
            })
          }}>Explain with AI</button>}
      </div>
      {generated && mode === 'generate' && <p className="model-output">{generated}</p>}
      {explanation && mode === 'analyze' && <p className="model-output"><strong>Round {explanation.round}</strong><br />{explanation.text}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </details>
}
