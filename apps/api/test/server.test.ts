import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { describe, it } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LlmProvider, PlatformPlugin } from '@jojo-claw/core'
import { createEmailAssistantPlugin } from '@jojo-claw/email-assistant'
import { createJojoClawServer } from '../src/server.js'

function temporarySecretFile(): { directory: string; path: string } { const directory = mkdtempSync(join(tmpdir(), 'jojo-claw-secrets-')); return { directory, path: join(directory, '.env') } }

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
        { id: 'database', name: 'Database', description: 'Configures the local database connection and manages platform schema.' },
        { id: 'secrets', name: 'Secrets', description: 'Lets you configure secrets requested by local plugins.' },
        { id: 'text', name: 'Text generation', description: 'Generates text using the platform-managed LLM provider.' },
        { id: 'email-assistant', name: 'Email assistant', description: 'Evaluates recent Gmail inbox messages into concise descriptions.' },
      ] })
      const generated = await fetch(`${baseUrl}/api/plugins/text/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Summarize this.', system: 'Be concise.' }) })
      assert.equal(generated.status, 200)
      assert.deepEqual(calls, [{ prompt: 'Summarize this.', system: 'Be concise.' }])
    } finally { server.close(); await once(server, 'close') }
  })

  it('fetches each inbox email server-side and evaluates it separately', async () => {
    const prompts: string[] = []
    const gmailFetch: typeof fetch = async (input) => {
      const url = String(input)
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email' })
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') return Response.json({ email: 'person@example.com' })
      if (url.includes('/messages?')) return Response.json({ messages: [{ id: 'one' }, { id: 'two' }] })
      if (url.includes('/messages/one')) return Response.json({ id: 'one', internalDate: '0', payload: { headers: [{ name: 'From', value: 'alice@example.com' }, { name: 'Subject', value: 'First' }], mimeType: 'text/plain', body: { data: 'SGVsbG8' } } })
      return Response.json({ id: 'two', internalDate: '1000', payload: { headers: [{ name: 'From', value: 'bob@example.com' }, { name: 'Subject', value: 'Second' }], mimeType: 'text/plain', body: { data: 'V29ybGQ' } } })
    }
    const provider: LlmProvider = { generate: async (input) => {
      prompts.push(input.prompt)
      return { text: `Description ${prompts.length}`, model: 'test-model' }
    } }
    const secretFile = temporarySecretFile()
    const server = createJojoClawServer({ provider, plugins: [createEmailAssistantPlugin({ fetch: gmailFetch })], secretFilePath: secretFile.path, databasePath: ':memory:' }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      await fetch(`${baseUrl}/api/plugins/secrets/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'email-assistant', id: 'google-client-id', value: 'client-id' }) })
      const connect = await fetch(`${baseUrl}/api/plugins/email-assistant/connect`, { redirect: 'manual' })
      assert.equal(connect.status, 302)
      const authorization = new URL(connect.headers.get('location') ?? '')
      const callback = await fetch(`${baseUrl}/api/plugins/email-assistant/oauth/callback?code=code&state=${encodeURIComponent(authorization.searchParams.get('state') ?? '')}`, { redirect: 'manual' })
      assert.equal(callback.status, 302)
      const response = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluate-inbox`, { method: 'POST' })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { result: { evaluations: [
        { messageId: 'one', from: 'alice@example.com', subject: 'First', receivedAt: '1970-01-01T00:00:00.000Z', description: 'Description 1' },
        { messageId: 'two', from: 'bob@example.com', subject: 'Second', receivedAt: '1970-01-01T00:00:01.000Z', description: 'Description 2' },
      ] } })
      assert.equal(prompts.length, 2)
      assert.match(prompts[0], /Hello/)
      assert.match(prompts[1], /World/)
    } finally { server.close(); await once(server, 'close'); rmSync(secretFile.directory, { recursive: true, force: true }) }
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
          async handle(input) { receivedBody = input.body; return { connected: true } },
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
    const secretFile = temporarySecretFile()
    const server = createJojoClawServer({ provider: { generate: async () => ({ text: 'unused', model: 'test' }) }, plugins: [plugin], secretFilePath: secretFile.path }).listen(0)
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const before = await fetch(`${baseUrl}/api/plugins/secrets/list`, { method: 'POST' })
      assert.deepEqual(await before.json(), { result: { secrets: [{ pluginId: 'weather', id: 'api-key', name: 'Weather API key', configured: false }] } })
      const updated = await fetch(`${baseUrl}/api/plugins/secrets/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'weather', id: 'api-key', value: 'private-value' }) })
      assert.equal(updated.status, 200)
      const after = await fetch(`${baseUrl}/api/plugins/secrets/list`, { method: 'POST' })
      assert.deepEqual(await after.json(), { result: { secrets: [{ pluginId: 'weather', id: 'api-key', name: 'Weather API key', configured: true }] } })
      const revealed = await fetch(`${baseUrl}/api/plugins/secrets/reveal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'weather', id: 'api-key' }) })
      assert.deepEqual(await revealed.json(), { result: { value: 'private-value' } })
      const checked = await fetch(`${baseUrl}/api/plugins/weather/check`, { method: 'POST' })
      assert.deepEqual(await checked.json(), { result: { configured: true } })
      assert.equal(configuredValue, 'private-value')
    } finally { server.close(); await once(server, 'close'); rmSync(secretFile.directory, { recursive: true, force: true }) }
  })

  it('restores plugin secrets from the local .env file after a server restart', async () => {
    const secretFile = temporarySecretFile()
    const plugin: PlatformPlugin = {
      manifest: { id: 'storage-test', name: 'Storage test', description: 'Checks durable secrets.' },
      register(context) {
        context.registerSecret({ id: 'credential', name: 'Credential' })
        context.registerRoute({ method: 'POST', path: '/value', async handle() { return { configured: context.getSecret('credential') === 'private-value' } } })
      },
    }
    const options = { provider: { generate: async () => ({ text: 'unused', model: 'test' }) }, plugins: [plugin], secretFilePath: secretFile.path }
    let server = createJojoClawServer(options).listen(0)
    await once(server, 'listening')
    try {
      let address = server.address(); assert(address && typeof address !== 'string')
      await fetch(`http://127.0.0.1:${address.port}/api/plugins/secrets/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'storage-test', id: 'credential', value: 'private-value' }) })
      server.close(); await once(server, 'close')
      server = createJojoClawServer(options).listen(0)
      await once(server, 'listening')
      address = server.address(); assert(address && typeof address !== 'string')
      const response = await fetch(`http://127.0.0.1:${address.port}/api/plugins/storage-test/value`, { method: 'POST' })
      assert.deepEqual(await response.json(), { result: { configured: true } })
    } finally { if (server.listening) { server.close(); await once(server, 'close') }; rmSync(secretFile.directory, { recursive: true, force: true }) }
  })
})
