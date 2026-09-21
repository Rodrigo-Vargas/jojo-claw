import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { type LlmProvider, type PlatformPlugin, type PluginRoute } from '@jojo-claw/core'
import { OllamaProvider } from '@jojo-claw/ollama'
import { createSecretsPlugin, SecretRegistry } from '@jojo-claw/secrets-plugin'
import { textPlugin } from '@jojo-claw/text-plugin'

export interface JojoClawOptions { provider?: LlmProvider; plugins?: PlatformPlugin[] }

/** Creates the HTTP boundary and mounts the locally installed plugin packages. */
export function createJojoClawServer(options: JojoClawOptions = {}) {
  const provider = options.provider ?? new OllamaProvider()
  const secrets = new SecretRegistry()
  const plugins = [createSecretsPlugin(secrets), ...(options.plugins ?? [textPlugin])]
  const routes = mountPlugins(plugins, provider, secrets)
  return createServer(async (request, response) => {
    setCors(response)
    if (request.method === 'OPTIONS') return response.end()
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    try {
      if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { status: 'ok' })
      if (request.method === 'GET' && url.pathname === '/api/plugins') return sendJson(response, 200, { plugins: plugins.map((plugin) => plugin.manifest) })
      const route = routes.get(`${request.method ?? 'GET'} ${url.pathname}`)
      if (route) return sendJson(response, 200, { result: await route.handle(request.method === 'POST' ? await readJson(request) : undefined) })
      return sendJson(response, 404, { error: 'Not found.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected server error.'
      return sendJson(response, message.includes('required') || message.includes('must be strings') ? 400 : 502, { error: message })
    }
  })
}

function mountPlugins(plugins: PlatformPlugin[], provider: LlmProvider, secrets: SecretRegistry): Map<string, PluginRoute> {
  const routes = new Map<string, PluginRoute>()
  for (const plugin of plugins) plugin.register({
    generateText: (input) => provider.generate(input),
    registerRoute: (route) => {
      if (!route.path.startsWith('/')) throw new Error(`Plugin route for ${plugin.manifest.id} must start with '/'.`)
      const key = `${route.method} /api/plugins/${plugin.manifest.id}${route.path}`
      if (routes.has(key)) throw new Error(`Duplicate plugin route: ${key}`)
      routes.set(key, route)
    },
    registerSecret: (secret) => secrets.register(plugin.manifest.id, secret),
    getSecret: (id) => secrets.get(plugin.manifest.id, id),
  })
  return routes
}

async function readJson<T>(request: IncomingMessage): Promise<T> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); const body = Buffer.concat(chunks).toString('utf8'); return (body ? JSON.parse(body) : undefined) as T }
function setCors(response: ServerResponse): void { response.setHeader('access-control-allow-origin', '*'); response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS'); response.setHeader('access-control-allow-headers', 'content-type') }
function sendJson(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)) }
