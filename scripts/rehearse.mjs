import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const config = {
  dist: resolve('dist'),
  output: resolve(process.env.GHOSTCHAIN_REHEARSAL_DIR ?? 'reports/rehearsal'),
  host: process.env.GHOSTCHAIN_REHEARSAL_URL ?? 'https://ghostchain.test/',
}
const syntheticOrigin = config.host === 'https://ghostchain.test/'
const record = process.argv.includes('--record')
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.csv': 'text/csv', '.bin': 'application/octet-stream', '.woff2': 'font/woff2',
}
await mkdir(config.output, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.GHOSTCHAIN_CHROMIUM || undefined,
  headless: true,
  args: ['--disable-dev-shm-usage'],
})

async function serve(route) {
  const path = decodeURIComponent(new URL(route.request().url()).pathname)
  const file = resolve(config.dist, '.' + (path === '/' ? '/index.html' : path))
  if (!file.startsWith(config.dist + sep)) return route.fulfill({ status: 404 })
  try { await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' }) }
  catch { await route.fulfill({ status: 404 }) }
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function run(pass) {
  const recording = record && pass === 2
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    reducedMotion: 'reduce',
    ...(recording ? { recordVideo: { dir: config.output, size: { width: 1440, height: 1080 } } } : {}),
  })
  if (syntheticOrigin) await context.route('https://ghostchain.test/**', serve)
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  const problems = []
  page.on('pageerror', error => problems.push(error.message))
  page.on('response', response => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`) })
  const mark = Date.now()
  const captions = []
  const note = (caption) => captions.push({ at: (Date.now() - mark) / 1000, caption })
  const snap = async (name, fullPage = false) => {
    if (recording || pass === 1) await page.screenshot({ path: resolve(config.output, `${name}.png`), fullPage })
    if (recording) await wait(3000)
  }
  const click = label => page.getByRole('button', { name: label, exact: true }).click()
  const slider = (label, value) => page.getByRole('slider', { name: label, exact: true }).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(value))
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)

  try {
    note('GHOSTCHAIN • A coded storage simulation with a live Node server')
    await page.goto(config.host)
    await page.locator('.metric > strong').filter({ hasText: /^Recovered$/ }).waitFor()
    await click('Pause')
    await snap('network')
    await slider('Fault injection', 0)
    await page.locator('.node-legend').getByText('100', { exact: true }).waitFor()
    note('Produce a block. The simulator encodes and recovers the original 6 MiB payload.')
    await click('Produce block')
    await page.getByText('#0002', { exact: true }).waitFor()
    await click('Light client')
    await page.getByText('WASM ready', { exact: true }).waitFor()
    note('Sample 30 cells. The light client verifies their KZG openings in WASM.')
    await page.getByLabel('Samples per round', { exact: true }).selectOption('30')
    await click('Verify samples')
    await page.getByText('All sampled cells verified', { exact: true }).waitFor()
    assert.match(await page.locator('.session-metrics').innerText(), /0\.870%/)
    await snap('verified')
    await page.getByLabel('Samples per round', { exact: true }).selectOption('16')
    await page.getByLabel('Sampling rounds', { exact: true }).selectOption('2')
    await click('Verify samples')
    await page.getByText('All sampled cells verified', { exact: true }).waitFor()
    assert.match(await page.locator('.session-metrics').innerText(), /0\.922%/)
    await page.getByLabel('Sampling rounds', { exact: true }).selectOption('1')
    note('Alter one shard while keeping the original proof. The verifier rejects it.')
    await click('Test tampered cell')
    await page.getByText('Tampered data rejected', { exact: true }).waitFor()
    await snap('tampered')

    note('Inject 50% faulty nodes, suppress a quadrant, and add 280 ms of latency.')
    await click('Network')
    await slider('Fault injection', 50)
    await slider('Quadrant withholding', 100)
    await slider('Latency spike', 280)
    await click('Resume')
    await page.locator('.chaos-foot strong').filter({ hasText: /^[34]\./ }).waitFor()
    await page.locator('.metric > strong').filter({ hasText: /^Recovered$/ }).waitFor()
    await click('Pause')
    await snap('stressed', true)

    note('Run a commit–reveal audit. A forged storage response loses eight credits.')
    await click('Run audit')
    const slashed = page.locator('.audit-log summary').filter({ hasText: 'slashed' }).first()
    await slashed.click()
    await snap('audit')
    await click('Benchmarks')
    note('Compare 100 paired trials per setting. At 60% combined stress, recovery is 100% versus 32%.')
    await page.locator('.results-table table tbody tr').first().waitFor()
    await snap('benchmarks', true)

    note('Time the browser verifier over 12 complete batches at 16, 24, and 30 samples.')
    await click('Measure WASM')
    await page.getByText('Raw timing JSON', { exact: true }).waitFor()
    const raw = await page.locator('.measurements pre').textContent()
    const data = JSON.parse(raw)
    assert.deepEqual(data.rows.map(row => row.timings.length), [12, 12, 12])
    await writeFile(resolve(config.output, `browser-wasm-${pass}.json`), JSON.stringify({
      ...data, playwright: require('playwright/package.json').version,
      chromium: browser.version(), warmupExcluded: true,
    }, null, 2) + '\n')
    await snap('timing')

    if (await page.getByText('Browser verification timing', { exact: true }).count()) {
      note('The optional Groth16 example proves membership of a hidden digest in a separate Poseidon tree.')
      await click('Light client')
      await click('Verify example proof')
      await page.getByText('Membership proof verified', { exact: true }).waitFor()
      await click('Test changed root')
      await page.getByText('Proof rejected for the supplied root', { exact: true }).waitFor()
      await snap('zk')
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await click('Network')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    assert.deepEqual(problems, [])
    console.log(`Rehearsal ${pass} passed in ${((Date.now() - mark) / 1000).toFixed(1)}s`)
  } catch (error) {
    console.error('Browser errors', problems)
    console.error((await page.locator('body').innerText()).slice(0, 900))
    await page.screenshot({ path: resolve(config.output, `failure-${pass}.png`) })
    throw error
  } finally {
    await context.close()
    if (recording) {
      await page.video().saveAs(resolve(config.output, 'rehearsal.webm'))
      await page.video().delete()
      await writeFile(resolve(config.output, 'captions.json'), JSON.stringify({ captions, duration: (Date.now() - mark) / 1000 }))
    }
  }
}

try {
  await run(1)
  await run(2)
} finally {
  await browser.close()
}
