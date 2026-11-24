import type { IncomingMessage, ServerResponse } from 'node:http'

const maxBody = 32_768
const metricNames = [
  'round',
  'recovered',
  'reachablePercent',
  'storagePercent',
  'replication',
  'faults',
  'withholding',
  'latencyMs',
] as const

export async function assist(
  request: IncomingMessage,
  response: ServerResponse,
) {
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Cache-Control', 'no-store')

  function reply(status: number, value: object) {
    response.statusCode = status
    response.end(JSON.stringify(value))
  }

  if (request.method !== 'POST') {
    return reply(405, { error: 'Use POST' })
  }

  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) {
    return reply(403, { error: 'Use the local AI server from this device' })
  }

  const { origin, host } = request.headers
  if (origin && origin !== `http://${host}` && origin !== `https://${host}`) {
    return reply(403, { error: 'Send AI requests from this app' })
  }

  const provider =
    process.env.GHOSTCHAIN_AI_PROVIDER ||
    (process.env.GEMINI_API_KEY
      ? 'gemini'
      : process.env.GROQ_API_KEY
        ? 'groq'
        : 'openai')

  const key =
    provider === 'gemini'
      ? process.env.GEMINI_API_KEY
      : provider === 'groq'
        ? process.env.GROQ_API_KEY
        : provider === 'openai'
          ? process.env.OPENAI_API_KEY
          : undefined

  if (!['gemini', 'groq', 'openai'].includes(provider)) {
    return reply(400, {
      error: 'GHOSTCHAIN_AI_PROVIDER must be gemini, openai, or groq.',
    })
  }

  if (!key) {
    return reply(503, {
      error: `Configure the API key for the selected provider (${provider}) in the server environment.`,
    })
  }

  let body: Record<string, unknown>

  try {
    let raw = ''

    for await (const chunk of request) {
      raw += chunk

      if (Buffer.byteLength(raw) > maxBody) {
        return reply(413, { error: 'Request is too large' })
      }
    }

    body = JSON.parse(raw)

    if (!body || typeof body !== 'object') {
      throw new Error('Invalid request')
    }
  } catch {
    return reply(400, { error: 'Send a JSON request' })
  }

  let input: string
  let instructions: string

  if (
    body.mode === 'generate' &&
    typeof body.prompt === 'string' &&
    body.prompt.trim() &&
    body.prompt.length <= 6000
  ) {
    input = body.prompt
    instructions =
      'Answer the user in plain text. Your response will become the payload of a local coded-storage simulation.'
  } else if (
    body.mode === 'explain' &&
    body.metrics &&
    typeof body.metrics === 'object'
  ) {
    const metrics = body.metrics as Record<string, unknown>

    if (
      !metricNames.every(name =>
        name === 'recovered'
          ? typeof metrics[name] === 'boolean'
          : Number.isFinite(metrics[name]),
      )
    ) {
      return reply(400, { error: 'Supply the recovery metrics' })
    }

    input = JSON.stringify(
      Object.fromEntries(metricNames.map(name => [name, metrics[name]])),
    )
    instructions =
      'Explain these coded-storage simulation metrics in plain language in up to three sentences. Only use the supplied metrics. Recovery means the decoded block matched the original bytes. State that these outcomes are from one simulated round.'
  } else {
    return reply(400, { error: 'Choose a mode and provide valid input' })
  }

  try {
    let url: string
    let headers: Record<string, string>
    let payload: object
    let format: 'gemini' | 'chat' | 'openai'

    if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        process.env.GHOSTCHAIN_GEMINI_MODEL || 'gemini-2.5-flash',
      )}:generateContent`
      headers = { 'x-goog-api-key': key }
      format = 'gemini'
      payload = {
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: 'user', parts: [{ text: input }] }],
        generationConfig: {
          maxOutputTokens: 512,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }
    } else if (provider === 'groq') {
      url = 'https://api.groq.com/openai/v1/chat/completions'
      headers = { Authorization: `Bearer ${key}` }
      format = 'chat'
      payload = {
        model: process.env.GHOSTCHAIN_GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: input },
        ],
        max_tokens: 512,
      }
    } else {
      url = 'https://api.openai.com/v1/responses'
      headers = { Authorization: `Bearer ${key}` }
      format = 'openai'
      payload = {
        model: process.env.GHOSTCHAIN_AI_MODEL ?? 'gpt-4.1-mini',
        instructions,
        input,
        max_output_tokens: 512,
        store: false,
      }
    }

    const requestHeaders = new Headers({
      'Content-Type': 'application/json',
    })

    for (const [name, value] of Object.entries(headers)) {
      requestHeaders.set(name, value)
    }

    const upstream = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(40000),
    })

    if (!upstream.ok) {
      const detail = (await upstream.json().catch(() => undefined)) as
        | { error?: { message?: string; status?: string } }
        | undefined

      const providerMessage = detail?.error?.message ?? ''
      let error = `${provider} returned HTTP ${upstream.status}.`

      if (upstream.status === 400 || upstream.status === 404) {
        error = `${provider} rejected the model or request. Check its configured model name.`
      } else if (upstream.status === 401 || upstream.status === 403) {
        error = `${provider} rejected the API key. Check that the key is valid and enabled.`
      } else if (upstream.status === 429) {
        error = `${provider} rate limit or quota reached. Check the provider account limits.`
      } else if (upstream.status >= 500) {
        error = `${provider} is temporarily unavailable. Try again shortly.`
      }

      console.error(
        `[ghostchain-ai] ${provider} request failed (${upstream.status}${detail?.error?.status ? ` ${detail.error.status}` : ''
        })${providerMessage ? `: ${providerMessage.slice(0, 300)}` : ''}`,
      )

      return reply(502, { error })
    }

    const result = (await upstream.json()) as {
      candidates?: {
        content?: { parts?: { text?: string; thought?: boolean }[] }
      }[]
      choices?: { message?: { content?: string } }[]
      output?: { content?: { type: string; text?: string }[] }[]
    }

    const text = (
      format === 'gemini'
        ? result.candidates?.[0]?.content?.parts
          ?.filter(part => !part.thought)
          .map(part => part.text ?? '')
        : format === 'chat'
          ? [result.choices?.[0]?.message?.content ?? '']
          : result.output
            ?.flatMap(item => item.content ?? [])
            .filter(item => item.type === 'output_text')
            .map(item => item.text ?? '')
    )
      ?.join('\n')
      .trim()

    if (!text) {
      return reply(502, { error: `${provider} returned no text` })
    }

    return reply(200, { text })
  } catch (cause) {
    console.error(
      `[ghostchain-ai] ${provider} request failed:`,
      cause instanceof Error ? cause.message : 'unknown error',
    )

    return reply(502, {
      error: `Could not reach ${provider}. Check your internet connection and try again.`,
    })
  }
}