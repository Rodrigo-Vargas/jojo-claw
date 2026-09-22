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
async function waitForEvaluation(baseUrl: string, evaluationId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluation-progress?evaluationId=${evaluationId}`)
    const payload = await response.json() as { result: Record<string, unknown> }
    if (payload.result.state !== 'running') return payload.result
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Inbox evaluation did not complete.')
}

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
        { id: 'settings', name: 'Settings', description: 'Stores and presents settings registered by local plugins.' },
        { id: 'text', name: 'Text generation', description: 'Generates text using the platform-managed LLM provider.' },
        { id: 'email-assistant', name: 'Email assistant', description: 'Evaluates recent Gmail inbox messages into concise descriptions.' },
      ] })
      const generated = await fetch(`${baseUrl}/api/plugins/text/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Summarize this.', system: 'Be concise.' }) })
      assert.equal(generated.status, 200)
      assert.deepEqual(calls, [{ prompt: 'Summarize this.', system: 'Be concise.' }])
    } finally { server.close(); await once(server, 'close') }
  })

  it('lists, validates, and restores settings registered by another plugin', async () => {
    const storage = temporarySecretFile()
    let observedSetting: number | undefined
    const plugin: PlatformPlugin = {
      manifest: { id: 'summarizer', name: 'Summarizer', description: 'Summarizes notes.' },
      register(context) {
        context.registerSetting({ id: 'max-items', name: 'Maximum items', description: 'How many notes to summarize.', type: 'number', defaultValue: 3 })
        context.registerRoute({ method: 'POST', path: '/configured', async handle() { observedSetting = context.getSetting('max-items') as number; return { maxItems: observedSetting } } })
      },
    }
    const options = { provider: { generate: async () => ({ text: 'unused', model: 'test' }) }, plugins: [plugin], settingsFilePath: storage.path }
    let server = createJojoClawServer(options).listen(0)
    await once(server, 'listening')
    try {
      let address = server.address(); assert(address && typeof address !== 'string')
      const baseUrl = `http://127.0.0.1:${address.port}`
      const listed = await fetch(`${baseUrl}/api/plugins/settings/list`, { method: 'POST' })
      assert.deepEqual(await listed.json(), { result: { settings: [{ pluginId: 'summarizer', id: 'max-items', name: 'Maximum items', description: 'How many notes to summarize.', type: 'number', defaultValue: 3, value: 3 }] } })
      const updated = await fetch(`${baseUrl}/api/plugins/settings/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'summarizer', id: 'max-items', value: 8 }) })
      assert.deepEqual(await updated.json(), { result: { value: 8 } })
      assert.deepEqual(await (await fetch(`${baseUrl}/api/plugins/summarizer/configured`, { method: 'POST' })).json(), { result: { maxItems: 8 } })
      assert.equal(observedSetting, 8)
      server.close(); await once(server, 'close')
      server = createJojoClawServer(options).listen(0); await once(server, 'listening')
      address = server.address(); assert(address && typeof address !== 'string')
      const restored = await fetch(`http://127.0.0.1:${address.port}/api/plugins/settings/list`, { method: 'POST' })
      assert.equal((await restored.json() as { result: { settings: Array<{ value: number }> } }).result.settings[0].value, 8)
    } finally { if (server.listening) { server.close(); await once(server, 'close') }; rmSync(storage.directory, { recursive: true, force: true }) }
  })

  it('persists JSON list settings and rejects non-list values', async () => {
    const storage = temporarySecretFile()
    const plugin: PlatformPlugin = {
      manifest: { id: 'filters', name: 'Filters', description: 'Filters messages.' },
      register(context) { context.registerSetting({ id: 'rules', name: 'Rules', type: 'list', defaultValue: [] }) },
    }
    const server = createJojoClawServer({ provider: { generate: async () => ({ text: 'unused', model: 'test' }) }, plugins: [plugin], settingsFilePath: storage.path }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const saved = await fetch(`${baseUrl}/api/plugins/settings/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'filters', id: 'rules', value: [{ field: 'from', value: 'news@example.com' }] }) })
      assert.deepEqual(await saved.json(), { result: { value: [{ field: 'from', value: 'news@example.com' }] } })
      const rejected = await fetch(`${baseUrl}/api/plugins/settings/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'filters', id: 'rules', value: { field: 'from' } }) })
      assert.equal(rejected.ok, false)
    } finally { server.close(); await once(server, 'close'); rmSync(storage.directory, { recursive: true, force: true }) }
  })

  it('summarizes and classifies each inbox email using configured categories', async () => {
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
      return { text: input.prompt.includes('Available categories:') ? (input.prompt.includes('Hello') ? 'Work' : 'Newsletters') : `Description ${prompts.length}`, model: 'test-model' }
    } }
    const secretFile = temporarySecretFile()
    const server = createJojoClawServer({ provider, plugins: [createEmailAssistantPlugin({ fetch: gmailFetch })], secretFilePath: secretFile.path, databasePath: ':memory:' }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      await fetch(`${baseUrl}/api/plugins/secrets/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'email-assistant', id: 'google-client-id', value: 'client-id' }) })
      await fetch(`${baseUrl}/api/plugins/settings/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'email-assistant', id: 'categories', value: [{ name: 'Work', action: 'archive' }, { name: 'Personal', action: 'keep' }] }) })
      const connect = await fetch(`${baseUrl}/api/plugins/email-assistant/connect`, { redirect: 'manual' })
      assert.equal(connect.status, 302)
      const authorization = new URL(connect.headers.get('location') ?? '')
      const callback = await fetch(`${baseUrl}/api/plugins/email-assistant/oauth/callback?code=code&state=${encodeURIComponent(authorization.searchParams.get('state') ?? '')}`, { redirect: 'manual' })
      assert.equal(callback.status, 302)
      const response = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluate-inbox`, { method: 'POST' })
      assert.equal(response.status, 200)
      const started = await response.json() as { result: { evaluationId: string } }
      assert.match(started.result.evaluationId, /^[a-f0-9]{32}$/)
      assert.deepEqual(await waitForEvaluation(baseUrl, started.result.evaluationId), {
        state: 'complete', total: 2, read: 2, evaluations: [
        { messageId: 'one', from: 'alice@example.com', subject: 'First', receivedAt: '1970-01-01T00:00:00.000Z', description: 'Description 1', category: 'Work' },
        { messageId: 'two', from: 'bob@example.com', subject: 'Second', receivedAt: '1970-01-01T00:00:01.000Z', description: 'Description 3', suggestedCategory: 'Newsletters' },
      ],
      })
      assert.equal(prompts.length, 4)
      assert.match(prompts[0], /Hello/)
      assert.match(prompts[1], /Available categories:\n- Work\n- Personal/)
      assert.match(prompts[2], /World/)
      assert.match(prompts[3], /Available categories:\n- Work\n- Personal/)
      const saved = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluations`)
      assert.deepEqual((await saved.json() as { result: Array<{ messageId: string }> }).result.map((email) => email.messageId), ['one', 'two'])
      const nextBatch = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluate-inbox`, { method: 'POST' })
      const nextBatchId = (await nextBatch.json() as { result: { evaluationId: string } }).result.evaluationId
      assert.deepEqual(await waitForEvaluation(baseUrl, nextBatchId), {
        state: 'complete', total: 0, read: 0, evaluations: [],
      })
      const confirmation = await fetch(`${baseUrl}/api/plugins/email-assistant/confirm-category`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: 'Newsletters', messageId: 'two' }) })
      assert.deepEqual(await confirmation.json(), { result: { category: 'Newsletters' } })
      const confirmed = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluations`)
      assert.deepEqual((await confirmed.json() as { result: Array<{ messageId: string; category?: string; suggestedCategory?: string }> }).result.find((email) => email.messageId === 'two'), { messageId: 'two', from: 'bob@example.com', subject: 'Second', receivedAt: '1970-01-01T00:00:01.000Z', description: 'Description 3', category: 'Newsletters' })
      const settings = await fetch(`${baseUrl}/api/plugins/settings/list`, { method: 'POST' })
      const categories = (await settings.json() as { result: { settings: Array<{ id: string; value: unknown }> } }).result.settings.find((setting) => setting.id === 'categories')
      assert.deepEqual(categories?.value, [{ name: 'Work', action: 'archive' }, { name: 'Personal', action: 'keep' }, { name: 'Newsletters', action: '' }])
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
