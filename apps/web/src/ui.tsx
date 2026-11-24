import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ChevronDown, CircleAlert, Copy, Download, Fingerprint } from 'lucide-react'
import { BLOCK_BYTES, CELLS, K, WIDTH } from '@ghostchain/core/model'
import type { NodeStatus } from '@ghostchain/core/model'
import type { Session } from './client'

export const number = new Intl.NumberFormat('en-US')
export const bytes = (value: number) => value >= 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${value} B`
export const blockLabel = (height: number) => String(height).padStart(4, '0')
export const idLabel = (node: number) => `N${String(node + 1).padStart(3, '0')}`

export const nodeNames: Record<NodeStatus, string> = {
  honest: 'Honest', offline: 'Offline', withholding: 'Withholding', delayed: 'Delayed',
}

export function PanelTitle({ title, detail, action }: { icon?: ReactNode, title: string, detail?: string, action?: ReactNode }) {
  return <div className="panel-heading">
    <div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>
    {action && <div className="panel-action">{action}</div>}
  </div>
}

export function Slider({ label, description, value, min, max, step = 1, unit, onChange }: {
  label: string, description: string, value: number, min: number, max: number, step?: number, unit: string, onChange: (value: number) => void,
}) {
  const [dragging, setDragging] = useState(false)
  return <label className="slider">
    <span className="slider-label">{label}<output>{value}{unit}</output></span>
    <span className="range-wrap">
      <input aria-label={label} aria-valuetext={`${value}${unit}`} type="range" min={min} max={max} step={step} value={value}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true) }}
        onLostPointerCapture={() => setDragging(false)} onBlur={() => setDragging(false)}
        onChange={event => onChange(event.currentTarget.valueAsNumber)} />
      {dragging && <span className="range-value" aria-hidden="true" style={{ left: `${(value - min) / (max - min) * 100}%` }}>{value}{unit}</span>}
    </span>
    <small>{description}</small>
  </label>
}

export function Select({ value, onChange, label, children }: {
  value: string | number, onChange: (value: string) => void, label: string, children: ReactNode,
}) {
  return <span className="select">
    <select value={value} aria-label={label} onChange={event => onChange(event.currentTarget.value)}>{children}</select>
    <ChevronDown size={15} aria-hidden="true" />
  </span>
}

export function DownloadLink({ href, label }: { href: string, label: string }) {
  return <a className="button secondary" href={href} download><Download size={15} />{label}</a>
}

export function MetricCards({ recovery, recoveryRate, recoveryRounds = 0, storage, session, factor, onClient }: {
  recovery?: boolean, recoveryRate?: number, recoveryRounds?: number, storage?: number, session: Session | null, factor?: number, onClient: () => void,
}) {
  const recoveredRounds = recoveryRate == null ? 0 : Math.round(recoveryRate * recoveryRounds / 100)
  const cards = [
    {
      label: 'Block recovery rate', value: recoveryRate == null ? 'Pending' : `${recoveryRate.toFixed(1)}%`,
      description: recovery == null ? 'Waiting for the first round' : `Current block: ${recoveredRounds}/${recoveryRounds} rounds recovered · Latest: ${recovery ? 'Recovered' : 'Unavailable'}`,
      accent: recoveryRate == null ? undefined : recoveryRate === 100 ? 'mint' : recoveryRate === 0 ? 'red' : undefined
    },
    { label: 'Storage per node', value: storage == null ? 'Pending' : `${storage.toFixed(2)}%`, description: factor == null ? '' : `Of a full block at ${factor.toFixed(2)}×` },
    { label: 'Sampling bandwidth', value: session && `${session.share.toFixed(3)}%`, description: session && bytes(session.bytes) },
    { label: 'Verification latency', value: session && `${Math.max(...session.timings).toFixed(1)} ms`, description: session && 'Slowest round in last session' },
  ]
  return <div className="metrics">{cards.map(card => <div className="metric" key={card.label}>
    <span>{card.label}</span>
    {card.value ? <strong className={card.accent}>{card.value}</strong> : <a href="#client" onClick={event => { event.preventDefault(); onClient() }}>Not measured · Run light client</a>}
    {card.description && <p>{card.description}</p>}
  </div>)}</div>
}
export function BlockStrip({ height, blockId, round, sourceBytes }: { height: number, blockId: string, round: number, sourceBytes?: number }) {
  const [feedback, setFeedback] = useState('')
  useEffect(() => { setFeedback('') }, [blockId])
  return <div className="block-strip" aria-label="Current block statistics" tabIndex={0}>
    <div className="strip-height"><span>Block</span><strong>#{blockLabel(height)}</strong></div>
    <div><span>Source size</span><strong>{sourceBytes == null ? `${BLOCK_BYTES / 1024 ** 2} MiB` : bytes(sourceBytes)}</strong></div>
    <div><span>Coded square</span><strong>{WIDTH} × {WIDTH}</strong></div>
    <div><span>Coded cells</span><strong>{number.format(CELLS)}</strong></div>
    <div className="strip-hash"><span>Commitment ID</span>
      {blockId ? <button className="hash-button" aria-label="Copy commitment ID" title={blockId} onClick={async () => {
        try { await navigator.clipboard.writeText(blockId); setFeedback('Copied') }
        catch { setFeedback('Copy unavailable') }
      }}><strong>{blockId.slice(0, 6)}…{blockId.slice(-5)}</strong><Copy size={12} aria-hidden="true" /></button> : <strong>Pending</strong>}
      <small role="status">{feedback}</small>
    </div>
    <div><span>Round</span><strong>{number.format(round)}</strong></div>
  </div>
}

export function SessionResult({ session }: { session: Session }) {
  const valid = session.samples.filter(item => item.state === 'verified').length
  const missing = session.samples.filter(item => item.state === 'missing').length
  const invalid = session.samples.length - valid - missing
  const result = invalid ? 'Tampered data rejected' : missing ? 'Availability unconfirmed' : 'All sampled cells verified'
  return <div className="session-result">
    <div className={`verdict ${invalid ? 'bad' : missing ? 'warn' : 'good'}`}>
      {valid === session.samples.length ? <Check size={19} /> : <CircleAlert size={19} />}
      <div><strong>{result}</strong><p>Block #{blockLabel(session.height)} · {valid} verified · {missing} unavailable · {invalid} invalid</p></div>
    </div>
    <div className="session-metrics">
      <div><span>Detection confidence</span><strong>{session.confidence ? `${(session.confidence * 100).toFixed(4)}%` : '—'}</strong></div>
      <div><span>Session traffic</span><strong>{bytes(session.bytes)} <small>{session.share.toFixed(3)}%</small></strong></div>
      <div><span>Verification per round</span><strong>{session.timings.map(time => time.toFixed(1)).join(' / ')} ms</strong></div>
    </div>
    <div className="sample-list" aria-label="Sample outcomes">{session.samples.map(({ index, state }) =>
      <span className={`sample ${state}`} key={index} title={`${state} · row ${Math.floor(index / WIDTH)}, column ${index % WIDTH}`}>
        {String(Math.floor(index / WIDTH)).padStart(3, '0')}.{String(index % WIDTH).padStart(3, '0')}
      </span>,
    )}</div>
    <p className="note">Each response carries a shard, its neighboring digest, and a 48-byte KZG opening.</p>
  </div>
}

export function EmptySession() {
  return <div className="empty">
    <strong>Ready to sample</strong><p>Run a session to inspect authenticated cells, missing responses, and verification timing.</p>
  </div>
}

export function ProtocolFacts() {
  return <article className="panel facts">
    <PanelTitle icon={<Fingerprint size={20} />} title="Verification protocol" />
    <dl>
      <div><dt>Reed–Solomon code</dt><dd>{K} → {WIDTH} on each axis</dd></div>
      <div><dt>Commitments</dt><dd>{WIDTH} × 48-byte KZG</dd></div>
      <div><dt>Verification</dt><dd>BLS12-381 WASM batch check</dd></div>
      <div><dt>Sampling</dt><dd>Uniform without replacement</dd></div>
    </dl>
    <div className="formula"><span>Detection model</span><code>1 − (1 − f)<sup>s</sup></code><p>With 25% of cells withheld, 16 clean samples give about 99.0% detection confidence and 30 give 99.9821%. More samples increase verification work.</p></div>
    <p className="note">KZG authenticates cells against a commitment. The light client does not prove that an untrusted producer encoded parity correctly. This simulator constructs parity locally.</p>
  </article>
}
