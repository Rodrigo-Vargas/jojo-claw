import assert from 'node:assert/strict'
import { once } from 'node:events'
import { describe, it } from 'node:test'
import type { LlmProvider } from '@jojo-claw/core'
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
      assert.deepEqual(await installed.json(), { plugins: [{ id: 'text', name: 'Text generation', description: 'Generates text using the platform-managed LLM provider.' }] })
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
})
