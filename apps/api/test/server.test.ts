import assert from 'node:assert/strict'
import { once } from 'node:events'
import { describe, it } from 'node:test'
import type { LlmProvider, PlatformPlugin } from '@jojo-claw/core'
import { createJojoClawServer } from '../src/server.js'

describe('Jojo Claw HTTP API', () => {
  it('mounts the installed text package and lets it use the platform provider', async () => {
    const calls: unknown[] = []
    const provider: LlmProvider = { generate: async (input) => { calls.push(input); return { text: 'Platform response', model: 'test-model' } } }
    const server = createJojoClawServer({ provider }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const installed = await fetch(`${baseUrl}/api/plugins`)
      assert.deepEqual(await installed.json(), { plugins: [
        { id: 'secrets', name: 'Secrets', description: 'Lets you configure secrets requested by local plugins.' },
        { id: 'text', name: 'Text generation', description: 'Generates text using the platform-managed LLM provider.' },
      ] })
      const generated = await fetch(`${baseUrl}/api/plugins/text/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Summarize this.', system: 'Be concise.' }) })
      assert.equal(generated.status, 200)
      assert.deepEqual(calls, [{ prompt: 'Summarize this.', system: 'Be concise.' }])
    } finally { server.close(); await once(server, 'close') }
  })

  it('returns not found for an uninstalled plugin route', async () => {
    const server = createJojoClawServer({ provider: { generate: async () => ({ text: 'unused', model: 'test' }) } }).listen(0)
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string')
    try { assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/plugins/missing/generate`, { method: 'POST' })).status, 404) } finally { server.close(); await once(server, 'close') }
  })

  it('mounts a plugin GET route without reading a request body', async () => {
    let receivedBody: unknown = 'not called'
    const plugin: PlatformPlugin = {
      manifest: { id: 'connection', name: 'Connection', description: 'Reports connection status.' },
      register(context) {
        context.registerRoute({
          method: 'GET',
          path: '/status',
          async handle(body) { receivedBody = body; return { connected: true } },
        })
      },
    }
    const server = createJojoClawServer({ provider: { generate: async () => ({ text: 'unused', model: 'test' }) }, plugins: [plugin] }).listen(0)
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/plugins/connection/status`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { result: { connected: true } })
      assert.equal(receivedBody, undefined)
    } finally { server.close(); await once(server, 'close') }
  })

  it('lets plugins register secrets without exposing their values in the list', async () => {
    let configuredValue: string | undefined
    const plugin: PlatformPlugin = {
      manifest: { id: 'weather', name: 'Weather', description: 'Uses a weather API.' },
      register(context) {
        context.registerSecret({ id: 'api-key', name: 'Weather API key' })
        context.registerRoute({ method: 'POST', path: '/check', async handle() { configuredValue = context.getSecret('api-key'); return { configured: Boolean(configuredValue) } } })
      },
    }
    const server = createJojoClawServer({ provider: { generate: async () => ({ text: 'unused', model: 'test' }) }, plugins: [plugin] }).listen(0)
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const before = await fetch(`${baseUrl}/api/plugins/secrets/list`, { method: 'POST' })
      assert.deepEqual(await before.json(), { result: { secrets: [{ pluginId: 'weather', id: 'api-key', name: 'Weather API key', configured: false }] } })
      const updated = await fetch(`${baseUrl}/api/plugins/secrets/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'weather', id: 'api-key', value: 'private-value' }) })
      assert.equal(updated.status, 200)
      const after = await fetch(`${baseUrl}/api/plugins/secrets/list`, { method: 'POST' })
      assert.deepEqual(await after.json(), { result: { secrets: [{ pluginId: 'weather', id: 'api-key', name: 'Weather API key', configured: true }] } })
      const checked = await fetch(`${baseUrl}/api/plugins/weather/check`, { method: 'POST' })
      assert.deepEqual(await checked.json(), { result: { configured: true } })
      assert.equal(configuredValue, 'private-value')
    } finally { server.close(); await once(server, 'close') }
  })
})
