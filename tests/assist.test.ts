import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { test } from 'node:test'
import { assist } from '../apps/web/assist.ts'
test('Groq provider uses its own key and chat completions route', async t => {
  const previous = {
    provider: process.env.GHOSTCHAIN_AI_PROVIDER,
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  }

  process.env.GHOSTCHAIN_AI_PROVIDER = 'groq'
  process.env.GROQ_API_KEY = 'test-only-groq'
  delete process.env.GEMINI_API_KEY
  delete process.env.OPENAI_API_KEY

  t.after(() => {
    const values: Record<string, string | undefined> = {
      GHOSTCHAIN_AI_PROVIDER: previous.provider,
      GROQ_API_KEY: previous.groq,
      GEMINI_API_KEY: previous.gemini,
      OPENAI_API_KEY: previous.openai,
    }

    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  t.mock.method(globalThis, 'fetch', async (target: string, options: RequestInit) => {
    assert.equal(target, 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal(
      new Headers(options.headers).get('Authorization'),
      'Bearer test-only-groq',
    )

    const body = JSON.parse(String(options.body))
    assert.equal(body.model, 'llama-3.3-70b-versatile')
    assert.equal(body.messages[1].content, 'Groq test')

    return Response.json({
      choices: [{ message: { content: 'Groq output' } }],
    })
  })

  const server = createServer((req, res) => {
    void assist(req, res)
  })

  await new Promise<void>(resolve =>
    server.listen(0, '127.0.0.1', resolve),
  )

  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      ),
  )

  const address = server.address()
  assert(address && typeof address !== 'string')

  const payload = JSON.stringify({
    mode: 'generate',
    prompt: 'Groq test',
  })

  const response = await new Promise<{ status?: number; text: string }>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/assist',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        res => {
          let text = ''
          res.on('data', chunk => {
            text += chunk
          })
          res.on('end', () => resolve({ status: res.statusCode, text }))
          res.on('error', reject)
        },
      )

      req.on('error', reject)
      req.end(payload)
    },
  )

  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.text), { text: 'Groq output' })
})