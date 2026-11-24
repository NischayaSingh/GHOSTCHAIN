import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { sampleIndices, sessionBytes } from '@ghostchain/core/das'
import { BLOCK_BYTES, CELLS, DEADLINE_MS } from '@ghostchain/core/model'
import { mix32 } from '@ghostchain/core/random'
import { RedundancyController } from '@ghostchain/core/redundancy'
import { makeNetwork, place } from '@ghostchain/core/sim'

const config = JSON.parse(readFileSync(new URL('./experiment-config.json', import.meta.url), 'utf8')) as {
  seed: number
  trials: number
  faults: number[]
  profiles: { name: string; withholding: number; latency: number }[]
  adaptiveWarmupRounds: number
  samples: number
}

const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
const rounded = (value: number) => Number(value.toFixed(4))
const rows = []
for (const profile of config.profiles) {
  for (const faults of config.faults) {
    const controls = { faults, withholding: profile.withholding, latency: profile.latency }
    const measurements = { static: [] as ReturnType<typeof trial>[], adaptive: [] as ReturnType<typeof trial>[], static4: [] as ReturnType<typeof trial>[] }
    for (let i = 0; i < config.trials; i++) {
      const seed = mix32(config.seed ^ i ^ (faults << 16))
      const controller = new RedundancyController()
      for (let round = 1; round <= config.adaptiveWarmupRounds; round++) {
        const observed = place(makeNetwork(mix32(seed ^ (round << 24)), controls), controller.factor, false, false)
        controller.observe(observed.dropout, observed.timeout)
      }
      const network = makeNetwork(seed, controls)
      const indices = sampleIndices(mix32(seed ^ 0xbbc9), config.samples, CELLS)
      measurements.static.push(trial(place(network, 2), indices))
      measurements.static4.push(trial(place(network, 4), indices))
      measurements.adaptive.push(trial(place(network, controller.factor), indices))
    }
    for (const strategy of ['static', 'adaptive', 'static4'] as const) {
      const entries = measurements[strategy]
      const finality = entries.flatMap(entry => entry.finality === null ? [] : [entry.finality])
      rows.push({
        profile: profile.name, faults, withholding: profile.withholding, latencyMs: profile.latency,
        strategy, trials: config.trials,
        recovered: finality.length,
        recoveryPct: rounded(finality.length / config.trials * 100),
        redundancy: rounded(average(entries.map(entry => entry.factor))),
        reachablePct: rounded(average(entries.map(entry => entry.reachable))),
        storagePctPerNode: rounded(average(entries.map(entry => entry.storage))),
        sampleBytes: rounded(average(entries.map(entry => entry.bandwidth))),
        samplePct: rounded(average(entries.map(entry => entry.bandwidth)) / BLOCK_BYTES * 100),
        finalityMs: finality.length ? rounded(average(finality)) : null,
        cappedFinalityMs: rounded(average(entries.map(entry => entry.finality ?? DEADLINE_MS))),
        completeSamplesPct: rounded(average(entries.map(entry => Number(entry.complete))) * 100),
      })
    }
    console.log(`${profile.name} · ${faults}% faults · static 2× ${rows.at(-3)!.recoveryPct}% · adaptive ${rows.at(-2)!.recoveryPct}% · static 4× ${rows.at(-1)!.recoveryPct}%`)
  }
}

function trial(placement: ReturnType<typeof place>, indices: number[]) {
  const received = indices.filter(index => placement.mask[index]).length
  return {
    factor: placement.factor, reachable: 100 * placement.reachable / CELLS, storage: placement.storagePercent,
    bandwidth: sessionBytes(indices.length, received, true), finality: placement.finalityMs,
    complete: received === indices.length,
  }
}

const json = JSON.stringify({ config, rows }, null, 2) + '\n'
const csv = [Object.keys(rows[0]).join(','), ...rows.map(row => Object.values(row).map(value => value ?? '').join(','))].join('\n') + '\n'
for (const [file, contents] of [['sweep.json', json], ['sweep.csv', csv]]) {
  const target = new URL(`../apps/web/public/results/${file}`, import.meta.url)
  if (process.argv.includes('--verify')) assert.equal(readFileSync(target, 'utf8'), contents)
  else writeFileSync(target, contents)
}
