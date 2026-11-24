import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, BarChart3, CircleAlert, CircleHelp, Fingerprint, Grid2X2, ShieldCheck } from 'lucide-react'
import { incentiveReturns } from '@ghostchain/core/audit'
import { BLOCK_BYTES, CELLS, COORDINATE_BYTES, DEFAULT_CONTROLS, DEMO_BLOCKS, HEADER_BYTES, SHARD_RESPONSE_BYTES } from '@ghostchain/core/model'
import type { Controls, NodeStatus } from '@ghostchain/core/model'
import { sample } from './client'
import type { Session } from './client'
import { benchmarkSeries, Chart, ChartLegend, strategySeries } from './charts'
import type { NetworkRequest, Snapshot, VerifyRequest } from './protocol'
import { WorkerRpc } from './rpc'
import { DownloadLink, EmptySession, MetricCards, PanelTitle, ProtocolFacts, Select, SessionResult, Slider, blockLabel, idLabel, nodeNames, number } from './ui'
import { WasmBenchmark } from './wasm-benchmark'
import { ZkExample } from './zk'
import { InputModes } from './input'
import './tokens.css'
import './style.css'

const network = new WorkerRpc<NetworkRequest>(new Worker(new URL('./network.worker.ts', import.meta.url), { type: 'module' }))
const verifier = new WorkerRpc<VerifyRequest>(new Worker(new URL('./verifier.worker.ts', import.meta.url), { type: 'module' }))
const tabs = [
  { id: 'network', label: 'Network', icon: Grid2X2 },
  { id: 'client', label: 'Light client', icon: Fingerprint },
  { id: 'benchmarks', label: 'Benchmarks', icon: BarChart3 },
] as const
type Tab = typeof tabs[number]['id']

const initialTab = (): Tab => tabs.find(tab => `#${tab.id}` === window.location.hash)?.id ?? 'network'
const statuses = Object.keys(nodeNames) as NodeStatus[]
type HistoryPoint = { round: number, height: number, adaptive: number, static: number, recovered: boolean }
const initialSeed = DEMO_BLOCKS[0]
const multiRoundLimit = Math.floor((BLOCK_BYTES * 0.01 - HEADER_BYTES) / (2 * (SHARD_RESPONSE_BYTES + COORDINATE_BYTES)))

function App() {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS)
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [running, setRunning] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cryptoStatus, setCryptoStatus] = useState<'starting' | 'ready' | 'failed'>('starting')
  const [session, setSession] = useState<Session | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [count, setCount] = useState(16)
  const [rounds, setRounds] = useState(1)
  const [selected, setSelected] = useState<number>()
  const [focusedNode, setFocusedNode] = useState(0)
  const [theme, setTheme] = useState(() => localStorage.getItem('ghostchain-theme') === 'light' ? 'light' : 'dark')
  const [showAdaptive, setShowAdaptive] = useState(true)
  const [auditError, setAuditError] = useState('')
  const [clientError, setClientError] = useState('')
  const help = useRef<HTMLDialogElement>(null)
  const selectedNode = selected == null ? undefined : snapshot?.nodes[selected]
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('ghostchain-theme', theme)
  }, [theme])

  function closeNode() {
    if (selected != null) grid.current?.querySelectorAll('button')[selected]?.focus()
    setSelected(undefined)
  }
  const [seed, setSeed] = useState(String(initialSeed))
  const requestBusy = useRef(false)
  const requestControls = useRef<Controls>(DEFAULT_CONTROLS)
  const queued = useRef<{ kind: 'tick' | 'publish' | 'audit' | 'reset', seed: number, input?: Uint8Array } | null>(null)
  const seeingRound = useRef(0)

  const warmup = useCallback(async () => {
    setCryptoStatus('starting')
    setClientError('')
    try {
      await verifier.call<boolean>({ kind: 'warmup' })
      setCryptoStatus('ready')
    } catch (cause) {
      setClientError(cause instanceof Error ? cause.message : String(cause))
      setCryptoStatus('failed')
    }
  }, [])

  const receive = useCallback((next: Snapshot) => {
    setSnapshot(next)
    if (next.round === seeingRound.current) return
    seeingRound.current = next.round
    setHistory(previous => [...previous.slice(-23), {
      round: next.round,
      height: next.height,
      adaptive: Number((next.adaptive.reachable / CELLS * 100).toFixed(1)),
      static: Number((next.baseline.reachable / CELLS * 100).toFixed(1)),
      recovered: next.byteVerified,
    }])
  }, [])

  const networkAction = useCallback(async (kind: 'tick' | 'publish' | 'audit' | 'reset', resetSeed = initialSeed as number, input?: Uint8Array) => {
    if (requestBusy.current) {
      if (kind !== 'tick') setBusy(true)
      if (!queued.current || kind !== 'tick') queued.current = { kind, seed: resetSeed, input }
      return
    }
    requestBusy.current = true
    if (kind !== 'tick') setBusy(true)
    if (kind === 'audit') setAuditError('')
    try {
      const request: NetworkRequest = kind === 'audit' ? { kind } : kind === 'reset'
        ? { kind, controls: requestControls.current, seed: resetSeed }
        : kind === 'publish' ? { kind, input, controls: requestControls.current }
          : { kind, controls: requestControls.current }
      const next = await network.call<Snapshot>(request)
      if (kind === 'reset') {
        setHistory([])
        seeingRound.current = 0
      }
      if (kind === 'publish' || kind === 'reset') setSession(null)
      receive(next)
      setError('')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (kind === 'audit') setAuditError(message)
      else setError(message)
      setRunning(false)
    } finally {
      requestBusy.current = false
      setBusy(false)
      const nextRequest = queued.current
      if (nextRequest) {
        queued.current = null
        void networkAction(nextRequest.kind, nextRequest.seed, nextRequest.input)
      }
    }
  }, [receive])

  useEffect(() => {
    void networkAction('tick')
    void warmup()
    const changeTab = () => setTab(initialTab())
    window.addEventListener('hashchange', changeTab)
    return () => window.removeEventListener('hashchange', changeTab)
  }, [networkAction, warmup])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => { if (!requestBusy.current) void networkAction('tick') }, 2700)
    return () => window.clearInterval(id)
  }, [running, networkAction])

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (requestControls.current !== DEFAULT_CONTROLS && requestControls.current === controls) void networkAction('tick')
    }, 180)
    return () => window.clearTimeout(id)
  }, [controls, networkAction])

  function change(key: keyof Controls, value: number) {
    const next = { ...requestControls.current, [key]: value }
    requestControls.current = next
    setControls(next)
  }

  function go(next: Tab) {
    setTab(next)
    window.history.pushState(null, '', `#${next}`)
  }

  async function verify(tamper: boolean) {
    if (verifying) return
    setVerifying(true)
    setClientError('')
    setSession(null)
    try {
      setSession(await sample(network, verifier, count, rounds, tamper))
      setCryptoStatus('ready')
    } catch (cause) {
      setClientError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setVerifying(false)
    }
  }

  function reset() {
    const parsed = Number(seed)
    if (!seed.trim() || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
      setError('Use a seed from 0 to 4,294,967,295.')
      return
    }
    requestControls.current = DEFAULT_CONTROLS
    setControls(DEFAULT_CONTROLS)
    void networkAction('reset', parsed)
  }

  const canPublish = !busy && !verifying && !!snapshot
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target
      if (event.repeat || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey
        || target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable], dialog')) return
      if (event.key === ' ') {
        if (target instanceof HTMLElement && target.closest('button, a, summary')) return
        event.preventDefault()
        setRunning(value => !value)
      } else if (event.key.toLowerCase() === 'b' && canPublish) {
        event.preventDefault()
        void networkAction('publish')
      } else if (event.key === '?') help.current?.showModal()
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [canPublish, networkAction])

  const recoveryHistory = snapshot ? history.filter(point => point.height === snapshot.height) : []
  const recoveryRate = recoveryHistory.length
    ? recoveryHistory.filter(point => point.recovered).length / recoveryHistory.length * 100
    : undefined

  return <>
    <header className="topbar">
      <div className="top-inner">
        <h1 className="brand"><a href="#network" onClick={event => { event.preventDefault(); go('network') }}>GHOSTCHAIN · Availability Lab</a></h1>
        <nav aria-label="Main navigation">{tabs.map(({ id, label }) =>
          <button type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} key={id} onClick={() => go(id)}>{label}</button>,
        )}</nav>
        <div className="toolbar">
          <button className="button ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
          <button className="button ghost" aria-label="Keyboard shortcuts" onClick={() => help.current?.showModal()}>?</button>
          <span className={`live ${running ? 'is-live' : ''}`}><i aria-hidden="true" />Round {snapshot?.round ?? 0} · {running ? 'running' : 'paused'}</span>
          <button className="button secondary" onClick={() => setRunning(value => !value)}>{running ? 'Pause' : 'Resume'}</button>
          <button className="button primary" disabled={!canPublish} onClick={() => void networkAction('publish')}>{busy ? 'Working…' : 'Produce block'}</button>
        </div>
      </div>
    </header>
    <dialog className="shortcuts" ref={help} aria-labelledby="shortcut-heading">
      <h2 id="shortcut-heading">Keyboard shortcuts</h2>
      <dl><div><dt><kbd>Space</kbd></dt><dd>Pause or resume</dd></div><div><dt><kbd>B</kbd></dt><dd>Produce demo block</dd></div><div><dt><kbd>?</kbd></dt><dd>Open this help</dd></div></dl>
      <form method="dialog"><button className="button secondary">Close</button></form>
    </dialog>
    <main className="shell">
      {error && <div className="message error" role="alert"><CircleAlert size={14} />{error}<button className="button ghost" onClick={() => setError('')} aria-label="Dismiss error">Dismiss</button></div>}
      {tab === 'network' && <>
        <div className="columns network-top">
          <article className="panel grid-panel" aria-busy={!snapshot && !error}>
            <PanelTitle title="Node grid" detail={snapshot ? `${snapshot.nodes.length} simulated nodes` : error ? 'Node data unavailable' : 'Preparing node assignments…'} />
            <div className="node-legend">{statuses.map(status => <span key={status}><i className={`glyph ${status}`} aria-hidden="true" />{nodeNames[status]} <b>{snapshot?.nodes.filter(node => node.status === status).length ?? '—'}</b></span>)}</div>
            <div className="node-grid" aria-label="Storage nodes" ref={grid}>{Array.from({ length: 100 }, (_, index) => {
              const node = snapshot?.nodes[index]
              if (!node) return <span key={index} className="node pending" aria-hidden="true" />
              const details = `${idLabel(index)} · ${nodeNames[node.status]} · ${node.slots} cells · ${snapshot.ledger[index]} credits`
              return <button key={index} className={`node ${node.status} ${index === selected ? 'selected' : ''}`}
                aria-label={details} aria-expanded={index === selected} aria-controls={index === selected ? 'node-detail' : undefined}
                title={details} tabIndex={index === focusedNode ? 0 : -1} onFocus={() => setFocusedNode(index)}
                onKeyDown={event => {
                  if (event.key === 'Escape' && selected === index) closeNode()
                  const columns = window.matchMedia('(max-width: 639px)').matches ? 10 : 20
                  const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }
                  const offset = offsets[event.key]
                  if (offset === undefined) return
                  event.preventDefault()
                  const nodes = grid.current?.querySelectorAll('button')
                  if (nodes) nodes[Math.max(0, Math.min(nodes.length - 1, index + offset))]?.focus()
                }}
                onClick={() => { if (selected === index) closeNode(); else setSelected(index) }}><i className="glyph" aria-hidden="true" /></button>
            })}</div>
            {selectedNode && <section className="node-detail" id="node-detail" aria-label="Selected node"
              onKeyDown={event => { if (event.key === 'Escape') closeNode() }}>
              <strong>{idLabel(selectedNode.id)}</strong><span>{nodeNames[selectedNode.status]}</span>
              <span>{number.format(selectedNode.slots)} assigned cells</span>
              <span>Audit balance <b>{snapshot?.ledger[selectedNode.id]} credits</b></span>
              <button className="button ghost compact" type="button" onClick={closeNode}>Close</button>
            </section>}
          </article>
          <section className="chaos">
            <PanelTitle title="Controls" detail="Changes apply on the next round." />
            <Slider label="Fault injection" description="Set nodes offline or withholding." value={controls.faults} min={0} max={60} unit="%" onChange={value => change('faults', value)} />
            <Slider label="Quadrant withholding" description="Suppress replies from the first quadrant." value={controls.withholding} min={0} max={100} unit="%" onChange={value => change('withholding', value)} />
            <Slider label="Latency spike" description="Add delay against the 300 ms deadline." value={controls.latency} min={0} max={500} step={10} unit=" ms" onChange={value => change('latency', value)} />
            <div className="chaos-foot"><label><input type="checkbox" checked={showAdaptive} onChange={event => setShowAdaptive(event.target.checked)} />Show adaptive series</label>
              <strong title="Current adaptive replication">{snapshot ? `${snapshot.adaptive.factor.toFixed(2)}×` : '—'}</strong></div>
            <p className="note">{snapshot?.sourceBytes == null ? 'Demo blocks use prepared KZG proofs.' : 'Custom block. Proofs are generated locally as cells are sampled.'}</p>
            <InputModes snapshot={snapshot} busy={busy || verifying || !snapshot} publish={input => void networkAction('publish', initialSeed, input)} />
          </section>
        </div>
        <MetricCards
          recovery={snapshot?.byteVerified}
          recoveryRate={recoveryRate}
          recoveryRounds={recoveryHistory.length}
          storage={snapshot?.adaptive.storagePercent}
          factor={snapshot?.adaptive.factor}
          session={session}
          onClient={() => go('client')}
        />
        <div className="columns lower">
          <article className="panel">
            <PanelTitle title="Reachable cells" detail="Cells served within 300 ms per network round." />
            {error && !history.length ? <p className="error">No round data available.</p> :
              <Chart data={history} series={showAdaptive ? strategySeries : strategySeries.slice(1)} x="round" live />}
            <div className="comparison-strip">
              <span>Adaptive finality <strong>{snapshot?.adaptive.finalityMs != null ? `${snapshot.adaptive.finalityMs} ms` : '—'}</strong></span>
              <span>Static finality <strong>{snapshot?.baseline.finalityMs != null ? `${snapshot.baseline.finalityMs} ms` : '—'}</strong></span>
            </div>
            <p className="note">The 75% line is a visual reference. Recovery depends on which cells are missing.</p>
          </article>
          <section className="audit">
            <PanelTitle title="Audit ledger" detail="Commit–reveal storage checks."
              action={<button className="button secondary compact" disabled={!snapshot || busy} onClick={() => void networkAction('audit')}>Run audit</button>} />
            {auditError && <p className="error" role="alert">{auditError}</p>}
            <div className="ledger-head">
              <span>Honest payoff <strong className="mint">+{incentiveReturns().honest.toFixed(1)}</strong></span>
              <span>Dishonest payoff <strong className="red">{incentiveReturns().dishonest}</strong></span>
              <span>Slashed <strong>{snapshot?.audits.filter(item => item.outcome === 'slashed').length ?? 0}</strong></span>
            </div>
            <div className="audit-log" aria-label="Audit events">
              {snapshot?.audits.length ? <table><thead><tr><th scope="col">Node</th><th scope="col">Action</th><th scope="col">Payout</th></tr></thead>
                <tbody>{snapshot.audits.map(event => <tr key={`${event.round}-${event.node}`}>
                  <td className="mono">{idLabel(event.node)}</td>
                  <td><details><summary className={event.outcome}>{event.outcome === 'offline' ? 'No response' : event.outcome}</summary>
                    <p>Round {event.round} · Cell {event.cell}<br />Commitment <code>{event.commitment || '—'}</code><br />Reveal nonce <code>{event.nonce ?? '—'}</code></p>
                  </details></td><td className="mono">{event.change > 0 ? '+' : ''}{event.change}</td>
                </tr>)}</tbody></table> : <p className="empty-audit">{error && !snapshot ? 'Audit data unavailable.' : 'No audits yet. Automatic audits run every four rounds.'}</p>}
            </div>
          </section>
        </div>
        <div className="network-footer"><label>Simulation seed <input type="number" min={0} max={0xffffffff} value={seed} onChange={event => setSeed(event.currentTarget.value)} /></label>
          <button className="button secondary compact" disabled={busy || verifying || !snapshot} onClick={reset}>Reset network</button></div>
      </>}
      {tab === 'client' && <>
        <section className="page-head"><div><h1>Light client</h1><p>Sample authenticated cells from the current block without downloading the full block.</p></div>
          <div className={`chip ${cryptoStatus}`}><i />{cryptoStatus === 'ready' ? 'WASM ready' : cryptoStatus === 'failed' ? 'WASM startup failed' : 'Loading WASM'}</div>
        </section>
        <div className="columns client-cols">
          <article className="panel">
            <PanelTitle icon={<Fingerprint size={20} />} title="Sampling session" detail="Each round checks a batch of distinct random cells." />
            <div className="client-controls">
              <label>Samples per round<Select value={count} onChange={value => setCount(Number(value))} label="Samples per round">
                {Array.from({ length: (rounds === 2 ? multiRoundLimit : 30) - 15 }, (_, index) => <option key={index} value={index + 16}>{index + 16} cells</option>)}
              </Select></label>
              <label>Rounds<Select value={rounds} onChange={value => {
                const next = Number(value)
                if (next === 2) setCount(previous => Math.min(previous, multiRoundLimit))
                setRounds(next)
              }} label="Sampling rounds">
                <option value={1}>1 round</option><option value={2}>2 rounds</option>
              </Select></label>
              <div className="actions">
                {cryptoStatus === 'failed' && <button className="button secondary" onClick={() => void warmup()}>Retry WASM</button>}
                <button className="button secondary" disabled={!snapshot || busy || verifying || cryptoStatus !== 'ready'} onClick={() => void verify(false)}><ShieldCheck size={16} />{verifying ? 'Verifying…' : 'Verify samples'}</button>
                <button className="button secondary" disabled={!snapshot || busy || verifying || cryptoStatus !== 'ready'} onClick={() => void verify(true)}>Test tampered cell</button>
              </div>
            </div>
            {rounds === 2 && <p className="note sampling-limit">Two rounds allow up to {multiRoundLimit} cells per round within the 1% budget.</p>}
            {clientError && <p className="error" role="alert">{clientError}</p>}
            {verifying && snapshot?.sourceBytes != null && <p className="note" role="status">Generating openings for sampled rows. The first session may take a few minutes.</p>}
            {snapshot?.sourceBytes != null && <p className="note">Traffic is measured against the 6 MiB padded block.</p>}
            {session ? <SessionResult session={session} /> : <EmptySession />}
          </article>
          <ProtocolFacts />
        </div>
        <ZkExample />
        <p className="subtle"><CircleHelp size={16} /> Availability claims are probabilistic. This simulator also checks reconstruction by decoding the original block byte for byte.</p>
      </>}
      {tab === 'benchmarks' && <Benchmarks ready={cryptoStatus === 'ready' && !!snapshot} customBlock={snapshot?.sourceBytes != null} />}
      <footer><span>GHOSTCHAIN</span><a href="./project/">Project files</a><span>Browser-only proof of concept</span></footer>
    </main>
  </>
}

interface SweepRow {
  profile: string
  faults: number
  strategy: 'adaptive' | 'static' | 'static4'
  recoveryPct: number
  storagePctPerNode: number
  samplePct: number
  cappedFinalityMs: number
  finalityMs: number | null
  completeSamplesPct: number
  redundancy: number
}

function Benchmarks({ ready, customBlock }: { ready: boolean, customBlock: boolean }) {
  const [rows, setRows] = useState<SweepRow[]>([])
  const [profile, setProfile] = useState('Combined stress')
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}results/sweep.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() })
      .then(result => setRows(result.rows)).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [])

  const selected = rows.filter(row => row.profile === profile)
  const pairs = selected.filter(row => row.strategy === 'adaptive').map(adaptive => ({
    faults: adaptive.faults,
    adaptive,
    baseline: selected.find(row => row.strategy === 'static' && row.faults === adaptive.faults)!,
    static4: selected.find(row => row.strategy === 'static4' && row.faults === adaptive.faults)!,
  }))
  return <>
    <section className="page-head"><div><h1>Benchmarks</h1><p>Compare adaptive replication with static 2× and 4×.</p></div>
      <div className="actions"><DownloadLink label="CSV" href="./results/sweep.csv" /><DownloadLink label="JSON" href="./results/sweep.json" /></div>
    </section>
    {error && <div className="message error" role="alert">Benchmark data could not be loaded.</div>}
    <div className="bench-controls"><label>Experiment profile <Select label="Experiment profile" value={profile} onChange={setProfile}>
      <option>Combined stress</option><option>Faults only</option>
    </Select></label><span>100 paired trials per fault level · 30 samples per round</span></div>
    <div className="columns bench-cols">
      <article className="panel">
        <PanelTitle icon={<ShieldCheck size={20} />} title="Recovery rate" detail="Trials whose original block is structurally recoverable." />
        <ChartLegend series={benchmarkSeries} />
        <Chart height={240} data={pairs.map(({ faults, adaptive, baseline, static4 }) => ({ faults: `${faults}%`, adaptive: adaptive.recoveryPct, static: baseline.recoveryPct, static4: static4.recoveryPct }))} series={benchmarkSeries} x="faults" />
      </article>
      <article className="panel">
        <PanelTitle icon={<Activity size={20} />} title="Deadline-capped finality" detail="Mean simulated time to decode, with failed trials scored at 300 ms." />
        <ChartLegend series={benchmarkSeries} />
        <Chart height={240} data={pairs.map(({ faults, adaptive, baseline, static4 }) => ({ faults: `${faults}%`, adaptive: adaptive.cappedFinalityMs, static: baseline.cappedFinalityMs, static4: static4.cappedFinalityMs }))} series={benchmarkSeries} x="faults" yUnit=" ms" domain={[0, 300]} />
      </article>
    </div>
    <article className="panel results-table">
      <PanelTitle icon={<BarChart3 size={20} />} title="Experiment results" detail={profile === 'Combined stress' ? 'Full first-quadrant withholding with a 280 ms latency spike.' : 'Faulty nodes with zero added latency and no quadrant withholding.'} />
      <div className="table-scroll"><table><thead><tr>{['Faults', 'Strategy', 'Copies', 'Recovery', 'Storage / node', 'DAS traffic', 'Complete samples', 'Finality¹'].map(title => <th scope="col" key={title}>{title}</th>)}</tr></thead>
        <tbody>{selected.map(row => <tr key={`${row.faults}-${row.strategy}`}>
          <td>{row.faults}%</td><td className="strategy">{row.strategy === 'adaptive' ? 'Adaptive' : row.strategy === 'static4' ? 'Static 4×' : 'Static 2×'}</td>
          <td>{row.redundancy.toFixed(2)}×</td><td>{row.recoveryPct.toFixed(0)}%</td><td>{row.storagePctPerNode.toFixed(2)}%</td>
          <td>{row.samplePct.toFixed(3)}%</td><td>{row.completeSamplesPct.toFixed(0)}%</td><td>{row.finalityMs === null ? '—' : `${row.finalityMs.toFixed(0)} ms`}</td>
        </tr>)}</tbody></table></div>
      <p className="note">¹ Mean among successful trials. Traffic includes the header and responses received.</p>
      <p className="note">Combined stress uses seeded random node faults, full first-quadrant withholding, a 280 ms latency spike and a 300 ms deadline. The sweep measures these conditions, with no worst-case adversary claim.</p>
      <p className="note">At 10% faults under combined stress, adaptive finality was 216 ms versus 209 ms for static 2×. Compare recovery and storage against both fixed baselines.</p>
    </article>
    <WasmBenchmark network={network} verifier={verifier} ready={ready && !customBlock} />
    {customBlock && <p className="note">Produce a demo block to run prepared-fixture timing.</p>}
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
