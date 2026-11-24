import { writeFile } from 'node:fs/promises'

const backend = process.argv[2]
if (!backend) {
  console.error('Usage: npm run configure:vercel -- https://your-node-backend.example.com')
  process.exit(1)
}
const url = new URL(backend)
if (url.protocol !== 'https:' || url.username || url.password || url.href !== url.origin + '/') {
  throw new Error('Provide the HTTPS origin of the hosted Node backend, with no path or credentials.')
}

const health = await fetch(new URL('/api/health', url), {
  redirect: 'error',
  signal: AbortSignal.timeout(60_000),
})
if (!health.ok) throw new Error(`Backend health check returned HTTP ${health.status}`)
const status = await health.json()
if (status.status !== 'ok' || status.service !== 'ghostchain-simulation') {
  throw new Error('The URL must point to a running GHOSTCHAIN simulation backend.')
}

const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [{
    source: '/api/:path*',
    destination: `${url.origin}/api/:path*`,
  }],
}

await writeFile(new URL('../vercel.json', import.meta.url), JSON.stringify(config, null, 2) + '\n')
console.log(`Configured Vercel to forward /api requests to ${url.origin}`)
