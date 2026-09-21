import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { type DatabaseOperations, type LlmProvider, type PlatformPlugin, type PluginRoute, type PluginRouteRedirect } from '@jojo-claw/core'
import { createDatabasePlugin } from '@jojo-claw/database-plugin'
import { OllamaProvider } from '@jojo-claw/ollama'
import { createSecretsPlugin, SecretRegistry } from '@jojo-claw/secrets-plugin'
import { createEmailAssistantPlugin } from '@jojo-claw/email-assistant'
import { textPlugin } from '@jojo-claw/text-plugin'

export interface JojoClawOptions {
  provider?: LlmProvider
  plugins?: PlatformPlugin[]
  secretFilePath?: string
  databasePath?: string
}

/** Creates the HTTP boundary and mounts the locally installed plugin packages. */
export function createJojoClawServer(options: JojoClawOptions = {}) {
  const provider = options.provider ?? new OllamaProvider()
  const secrets = new SecretRegistry(options.secretFilePath ?? resolve(process.cwd(), '.env'))
  const database = createDatabasePlugin({ storagePath: options.databasePath })
  const plugins = [
    database.plugin,
    createSecretsPlugin(secrets),
    ...(options.plugins ?? [textPlugin, createEmailAssistantPlugin()]),
  ]
  const routes = mountPlugins(plugins, provider, secrets, database.operations)
  return createServer(async (request, response) => {
    setCors(response)
    if (request.method === 'OPTIONS') return response.end()
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    try {
      if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { status: 'ok' })
      if (request.method === 'GET' && url.pathname === '/api/plugins') return sendJson(response, 200, { plugins: plugins.map((plugin) => plugin.manifest) })
      const route = routes.get(`${request.method ?? 'GET'} ${url.pathname}`)
      if (route) {
        const result = await route.handle({ method: request.method === 'GET' ? 'GET' : 'POST', query: Object.fromEntries(url.searchParams), body: request.method === 'POST' ? await readJson(request) : undefined })
        if (isPluginRouteRedirect(result)) {
          response.writeHead(result.status ?? 302, { location: result.location })
          return response.end()
        }
        return sendJson(response, 200, { result })
      }
      return sendJson(response, 404, { error: 'Not found.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected server error.'
      return sendJson(response, message.includes('required') || message.includes('must be strings') ? 400 : 502, { error: message })
    }
  })
}

function mountPlugins(
  plugins: PlatformPlugin[],
  provider: LlmProvider,
  secrets: SecretRegistry,
  database: DatabaseOperations,
): Map<string, PluginRoute> {
  const routes = new Map<string, PluginRoute>()
  for (const plugin of plugins) plugin.register({
    generateText: (input) => provider.generate(input),
    database,
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

function isPluginRouteRedirect(value: unknown): value is PluginRouteRedirect {
  return typeof value === 'object' && value !== null && (value as PluginRouteRedirect).type === 'redirect' && typeof (value as PluginRouteRedirect).location === 'string'
}

async function readJson<T>(request: IncomingMessage): Promise<T> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); const body = Buffer.concat(chunks).toString('utf8'); return (body ? JSON.parse(body) : undefined) as T }
function setCors(response: ServerResponse): void { response.setHeader('access-control-allow-origin', '*'); response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS'); response.setHeader('access-control-allow-headers', 'content-type') }
function sendJson(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)) }
