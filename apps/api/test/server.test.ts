import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LlmProvider, PlatformPlugin } from '@jojo-claw/core'
import { createEmailAssistantPlugin } from '@jojo-claw/email-assistant'
import type { GenerateWithToolsInput } from '@jojo-claw/core'
import { OllamaProvider } from '@jojo-claw/ollama'
import { createJojoClawServer } from '../src/server.js'
import { setPromptContent } from '@jojo-claw/tool-calling-plugin'

function temporarySecretFile(): { directory: string; path: string } { const directory = mkdtempSync(join(tmpdir(), 'jojo-claw-secrets-')); return { directory, path: join(directory, '.env') } }
async function waitForCategoryResults(baseUrl: string): Promise<Array<Record<string, unknown>>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluations`)
    const payload = await response.json() as { result: Array<Record<string, unknown>> }
    if (payload.result.every((email) => email.categoryStatus !== 'processing')) return payload.result
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Category evaluation did not complete.')
}

describe('Jojo Claw HTTP API', () => {
  it('updates a prompt through the prompt tool', () => {
    const updates: Array<{ pluginId: string; id: string; content: string }> = []
    const result = setPromptContent({ setPrompt(pluginId, id, content) { updates.push({ pluginId, id, content }) } }, { pluginId: 'summarizer', id: 'instructions', content: 'Use one sentence.' })
    assert.deepEqual(result, { pluginId: 'summarizer', id: 'instructions', content: 'Use one sentence.' })
    assert.deepEqual(updates, [{ pluginId: 'summarizer', id: 'instructions', content: 'Use one sentence.' }])
    assert.throws(() => setPromptContent({ setPrompt() {} }, { pluginId: '', id: 'instructions', content: 'Text' }), /expected a non-empty string/)
  })

  it('adapts platform tool messages to Ollama’s function-call wire format', async () => {
    const requests: unknown[] = []
    const request: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return Response.json({ model: 'llama-test', message: { content: '', tool_calls: [{ function: { name: 'calculate', arguments: { expression: '2 + 2' } } }] } })
    }
    const provider = new OllamaProvider({ fetch: request, model: 'llama3.2' })
    const result = await provider.generateWithTools({
      messages: [{ role: 'user', content: 'Calculate 2 + 2.' }],
      tools: [{ name: 'calculate', description: 'Does arithmetic.', parameters: { type: 'object' } }],
    })
    assert.deepEqual(result, { text: '', model: 'llama-test', toolCalls: [{ id: 'ollama-0', name: 'calculate', arguments: { expression: '2 + 2' } }] })
    assert.deepEqual(requests, [{ model: 'llama3.2', messages: [{ role: 'user', content: 'Calculate 2 + 2.' }], tools: [{ type: 'function', function: { name: 'calculate', description: 'Does arithmetic.', parameters: { type: 'object' } } }], stream: false }])
  })

  it('lists installed Ollama models from the tags endpoint', async () => {
    const provider = new OllamaProvider({
      fetch: async (input) => {
        assert.equal(String(input), 'http://127.0.0.1:11434/api/tags')
        return Response.json({ models: [{ name: 'qwen3:8b' }, { name: 'gemma3:4b' }] })
      },
    })
    assert.deepEqual(await provider.listModels(), [{ name: 'qwen3:8b' }, { name: 'gemma3:4b' }])
  })

  it('uses the persisted default model selected from Ollama tags', async () => {
    const storage = temporarySecretFile()
    const requests: unknown[] = []
    const server = createJojoClawServer({
      settingsFilePath: storage.path,
      ollama: { fetch: async (input, init) => {
        if (String(input).endsWith('/api/tags'))
          return Response.json({ models: [{ name: 'qwen3:8b' }] })
        requests.push(JSON.parse(String(init?.body)))
        return Response.json({ model: 'qwen3:8b', message: { content: 'Done.' } })
      } },
    }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const models = await fetch(`${baseUrl}/api/ollama/models`)
      assert.deepEqual(await models.json(), { options: ['qwen3:8b'] })
      await fetch(`${baseUrl}/api/plugins/settings/set`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pluginId: 'ollama', id: 'default-model', value: 'qwen3:8b' }),
      })
      const response = await fetch(`${baseUrl}/api/plugins/text/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'Say done.' }),
      })
      assert.equal(response.ok, true)
      assert.deepEqual(requests, [{ model: 'qwen3:8b', messages: [{ role: 'user', content: 'Say done.' }], stream: false }])
    } finally { server.close(); await once(server, 'close'); rmSync(storage.directory, { recursive: true, force: true }) }
  })

  it('mounts the installed text package and lets it use the platform provider', async () => {
    const calls: unknown[] = []
    const provider: LlmProvider = { generate: async (input) => { calls.push(input); return { text: 'Platform response', model: 'test-model' } } }
    const server = createJojoClawServer({ provider, databasePath: ':memory:' }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const installed = await fetch(`${baseUrl}/api/plugins`)
      assert.deepEqual(await installed.json(), { plugins: [
        { id: 'database', name: 'Database', description: 'Provides local SQLite storage for installed plugins.' },
        { id: 'secrets', name: 'Secrets', description: 'Lets you configure secrets requested by local plugins.' },
        { id: 'settings', name: 'Settings', description: 'Stores and presents settings registered by local plugins.' },
        { id: 'prompts', name: 'Prompts', description: 'Stores and presents prompts registered by local plugins.' },
        { id: 'text', name: 'Text generation', description: 'Generates text using the platform-managed LLM provider.' },
        { id: 'tool-calling', name: 'Tool calling', description: 'Lets the model request safe local tools and use their results.' },
        { id: 'email-assistant', name: 'Email assistant', description: 'Evaluates recent Gmail inbox messages into concise descriptions.' },
      ] })
      const generated = await fetch(`${baseUrl}/api/plugins/text/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Summarize this.', system: 'Be concise.' }) })
      assert.equal(generated.status, 200)
      assert.deepEqual(calls, [{ prompt: 'Summarize this.', system: 'Be concise.' }])
    } finally { server.close(); await once(server, 'close') }
  })

  it('reports queued prompt jobs and their final statuses', async () => {
    let releaseGeneration: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const generationStarted = new Promise<void>((resolve) => { markStarted = resolve })
    const generationRelease = new Promise<void>((resolve) => { releaseGeneration = resolve })
    const provider: LlmProvider = {
      generate: async (input) => {
        markStarted?.()
        await generationRelease
        return { text: input.prompt, model: 'test-model' }
      },
    }
    const server = createJojoClawServer({ provider, databasePath: ':memory:' }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const first = fetch(`${baseUrl}/api/plugins/text/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'First request' }) })
      await generationStarted
      const second = fetch(`${baseUrl}/api/plugins/text/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Second request' }) })
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
      const active = await fetch(`${baseUrl}/api/prompt-queue`)
      assert.deepEqual(await active.json(), { items: [
        { id: 1, pluginName: 'Text generation', prompt: 'First request', status: 'running' },
        { id: 2, pluginName: 'Text generation', prompt: 'Second request', status: 'queued' },
      ] })
      releaseGeneration?.()
      await Promise.all([first, second])
      const completed = await fetch(`${baseUrl}/api/prompt-queue`)
      assert.deepEqual((await completed.json() as { items: Array<{ status: string }> }).items.map((item) => item.status), ['succeeded', 'succeeded'])
    } finally { server.close(); await once(server, 'close') }
  })

  it('requeues a failed prompt without creating another conversation', async () => {
    const requests: string[] = []
    const provider: LlmProvider = {
      generate: async (input) => {
        requests.push(input.prompt)
        if (requests.length === 1) throw new Error('Provider unavailable.')
        return { text: 'Retry succeeded', model: 'test-model' }
      },
    }
    const server = createJojoClawServer({ provider, databasePath: ':memory:' }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const initial = await fetch(`${baseUrl}/api/plugins/text/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'Try this again.' }),
      })
      assert.equal(initial.status, 502)
      const retry = await fetch(`${baseUrl}/api/conversations/1/retry`, { method: 'POST' })
      assert.equal(retry.status, 202)
      assert.deepEqual(await retry.json(), { conversationId: 1 })
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
      const retried = await fetch(`${baseUrl}/api/conversations/1`)
      const payload = await retried.json() as {
        conversation: {
          status: string; prompt: string; createdAt: string; completedAt: string;
          response?: { text: string };
        }
      }
      assert.deepEqual(payload.conversation, {
        status: 'succeeded', prompt: 'Try this again.',
        response: { text: 'Retry succeeded', model: 'test-model' }, id: 1,
        pluginName: 'Text generation', createdAt: payload.conversation.createdAt,
        completedAt: payload.conversation.completedAt,
      })
      assert.deepEqual(requests, ['Try this again.', 'Try this again.'])
    } finally { server.close(); await once(server, 'close') }
  })

  it('persists completed prompt conversations for later retrieval', async () => {
    const storage = temporarySecretFile()
    const provider: LlmProvider = {
      generate: async () => ({ text: 'Saved response', model: 'test-model' }),
    }
    const firstServer = createJojoClawServer({ provider, databasePath: join(storage.directory, 'conversations.db') }).listen(0)
    await once(firstServer, 'listening')
    const firstAddress = firstServer.address(); assert(firstAddress && typeof firstAddress !== 'string')
    try {
      await fetch(`http://127.0.0.1:${firstAddress.port}/api/plugins/text/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Remember this.' }),
      })
    } finally { firstServer.close(); await once(firstServer, 'close') }

    const secondServer = createJojoClawServer({ provider, databasePath: join(storage.directory, 'conversations.db') }).listen(0)
    await once(secondServer, 'listening')
    const secondAddress = secondServer.address(); assert(secondAddress && typeof secondAddress !== 'string')
    try {
      const response = await fetch(`http://127.0.0.1:${secondAddress.port}/api/conversations`)
      const payload = await response.json() as { conversations: Array<Record<string, unknown>> }
      assert.equal(payload.conversations.length, 1)
      assert.deepEqual(payload.conversations[0], {
        id: 1, pluginName: 'Text generation', prompt: 'Remember this.', status: 'succeeded',
        createdAt: payload.conversations[0]?.createdAt,
        completedAt: payload.conversations[0]?.completedAt,
        response: { text: 'Saved response', model: 'test-model' },
      })
      assert.equal(typeof payload.conversations[0]?.createdAt, 'string')
      assert.equal(typeof payload.conversations[0]?.completedAt, 'string')
    } finally { secondServer.close(); await once(secondServer, 'close'); rmSync(storage.directory, { recursive: true, force: true }) }
  })

  it('returns a conversation transcript and queues its follow-up after earlier work', async () => {
    const prompts: string[] = []
    const provider: LlmProvider = {
      generate: async (input) => {
        prompts.push(input.prompt)
        return { text: `Answer ${prompts.length}`, model: 'test-model' }
      },
    }
    const server = createJojoClawServer({ provider, databasePath: ':memory:' }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      await fetch(`${baseUrl}/api/plugins/text/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'First question' }),
      })
      const followUp = await fetch(`${baseUrl}/api/conversations/1`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Follow-up question' }),
      })
      assert.equal(followUp.status, 200)
      assert.equal(prompts[1], [
        'User: First question', 'Assistant: Answer 1',
        'User: Follow-up question', 'Assistant:',
      ].join('\n\n'))
      const detail = await fetch(`${baseUrl}/api/conversations/2`)
      const payload = await detail.json() as {
        conversation: { id: number; parentConversationId?: number }
        messages: Array<{ prompt: string; response?: { text: string } }>
      }
      assert.equal(payload.conversation.id, 2)
      assert.equal(payload.conversation.parentConversationId, 1)
      assert.deepEqual(payload.messages.map((message) => message.prompt), [
        'First question', 'Follow-up question',
      ])
      assert.deepEqual(payload.messages.map((message) => message.response?.text), [
        'Answer 1', 'Answer 2',
      ])
    } finally { server.close(); await once(server, 'close') }
  })

  it('returns tool output to the model before returning its final answer', async () => {
    const toolRequests: GenerateWithToolsInput[] = []
    const provider: LlmProvider = {
      generate: async () => ({ text: 'unused', model: 'test' }),
      generateWithTools: async (input) => {
        toolRequests.push(input)
        if (toolRequests.length === 1)
          return { text: '', model: 'test', toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '6 * 7' } }] }
        return { text: 'The answer is 42.', model: 'test', toolCalls: [] }
      },
    }
    const server = createJojoClawServer({ provider, databasePath: ':memory:' }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/plugins/tool-calling/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Calculate 6 times 7.' }) })
      assert.deepEqual(await response.json(), { result: { text: 'The answer is 42.', model: 'test', calls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '6 * 7' }, result: '42' }] } })
      assert.deepEqual(toolRequests[1]?.messages.at(-1), { role: 'tool', content: '42', toolCallId: 'call-1' })
      const conversation = await fetch(`http://127.0.0.1:${address.port}/api/conversations/1`)
      const payload = await conversation.json() as {
        conversation: { response?: { toolCalls?: Array<{ result?: string }> } }
      }
      assert.deepEqual(payload.conversation.response?.toolCalls, [{
        id: 'call-1', name: 'calculate', arguments: { expression: '6 * 7' }, result: '42',
      }])
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

  it("isolates records written by different plugins", async () => {
    let firstValue: string | undefined
    let secondValue: string | undefined
    const plugins: PlatformPlugin[] = [
      { manifest: { id: "first", name: "First", description: "Writes a record." }, register(context) {
        context.storage.set("shared-key", "first-value")
        firstValue = context.storage.get<string>("shared-key")
      } },
      { manifest: { id: "second", name: "Second", description: "Reads its own records." }, register(context) {
        secondValue = context.storage.get<string>("shared-key")
      } },
    ]
    const server = createJojoClawServer({ provider: { generate: async () => ({ text: "unused", model: "test" }) }, plugins }).listen(0)
    await once(server, "listening")
    try {
      assert.equal(firstValue, "first-value")
      assert.equal(secondValue, undefined)
    } finally { server.close(); await once(server, "close") }
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

  it('lets plugins declare prompts and persists their edited content in the prompts folder', async () => {
    const storage = temporarySecretFile()
    let observedPrompt: string | undefined
    const plugin: PlatformPlugin = {
      manifest: { id: 'summarizer', name: 'Summarizer', description: 'Summarizes notes.' },
      register(context) {
        context.definePrompt({ id: 'instructions', name: 'Summary instructions', kind: 'system', defaultContent: 'Be concise.' })
        context.registerRoute({ method: 'POST', path: '/configured', async handle() { observedPrompt = context.getPrompt('instructions'); return { prompt: observedPrompt } } })
      },
    }
    const server = createJojoClawServer({ provider: { generate: async () => ({ text: 'unused', model: 'test' }) }, plugins: [plugin], promptsDirectory: join(storage.directory, 'prompts') }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const listed = await fetch(`${baseUrl}/api/plugins/prompts/list`, { method: 'POST' })
      assert.deepEqual(await listed.json(), { result: { prompts: [{ pluginId: 'summarizer', id: 'instructions', name: 'Summary instructions', kind: 'system', defaultContent: 'Be concise.', content: 'Be concise.' }] } })
      const updated = await fetch(`${baseUrl}/api/plugins/prompts/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'summarizer', id: 'instructions', content: 'Use one sentence.' }) })
      assert.deepEqual(await updated.json(), { result: { content: 'Use one sentence.' } })
      assert.deepEqual(await (await fetch(`${baseUrl}/api/plugins/summarizer/configured`, { method: 'POST' })).json(), { result: { prompt: 'Use one sentence.' } })
      assert.equal(observedPrompt, 'Use one sentence.')
    } finally { server.close(); await once(server, 'close'); rmSync(storage.directory, { recursive: true, force: true }) }
  })

  it('summarizes and classifies each inbox email using configured categories', async () => {
    const prompts: string[] = []
    const gmailActions: Array<{ url: string; body?: string }> = []
    const gmailFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST' && url.includes('/messages/')) {
        gmailActions.push({ url, body: typeof init.body === 'string' ? init.body : undefined })
        return Response.json({ id: 'one' })
      }
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email' })
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') return Response.json({ email: 'person@example.com' })
      if (url.includes('/messages?')) return Response.json({ messages: [{ id: 'one' }, { id: 'two' }] })
      if (url.includes('/messages/one')) return Response.json({ id: 'one', internalDate: '0', payload: { headers: [{ name: 'From', value: 'alice@example.com' }, { name: 'Subject', value: 'First' }], mimeType: 'text/plain', body: { data: 'SGVsbG8' } } })
      return Response.json({ id: 'two', internalDate: '1000', payload: { headers: [{ name: 'From', value: 'bob@example.com' }, { name: 'Subject', value: 'Second' }], mimeType: 'text/plain', body: { data: 'V29ybGQ' } } })
    }
    const toolRequests: GenerateWithToolsInput[] = []
    const provider: LlmProvider = { generate: async (input) => {
      prompts.push(input.prompt)
      return { text: `Description ${prompts.length}`, model: 'test-model' }
    }, generateWithTools: async (input) => {
      toolRequests.push(input)
      const prompt = input.messages.at(-1)?.content ?? ''
      const name = prompt.includes('Hello') ? 'confirm_existing_category' : 'suggest_new_category'
      const category = prompt.includes('Hello') ? 'Work' : 'Newsletters'
      return { text: '', model: 'test-model', toolCalls: [{ id: 'call-1', name, arguments: { category } }] }
    } }
    const secretFile = temporarySecretFile()
    const server = createJojoClawServer({ provider, plugins: [createEmailAssistantPlugin({ fetch: gmailFetch })], secretFilePath: secretFile.path, databasePath: ':memory:' }).listen(0)
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      await fetch(`${baseUrl}/api/plugins/secrets/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'email-assistant', id: 'google-client-id', value: 'client-id' }) })
      await fetch(`${baseUrl}/api/plugins/settings/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'email-assistant', id: 'categories', value: ['Work', 'Personal'] }) })
      const connect = await fetch(`${baseUrl}/api/plugins/email-assistant/connect`, { redirect: 'manual' })
      assert.equal(connect.status, 302)
      const authorization = new URL(connect.headers.get('location') ?? '')
      const callback = await fetch(`${baseUrl}/api/plugins/email-assistant/oauth/callback?code=code&state=${encodeURIComponent(authorization.searchParams.get('state') ?? '')}`, { redirect: 'manual' })
      assert.equal(callback.status, 302)
      const response = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluate-inbox`, { method: 'POST' })
      assert.equal(response.status, 200)
      const started = await response.json() as { result: { evaluations: Array<{ categoryStatus: string }> } }
      assert.equal(started.result.evaluations.length, 2)
      assert.ok(started.result.evaluations.some((email) => email.categoryStatus === 'processing'))
      assert.deepEqual(await waitForCategoryResults(baseUrl), [
        { messageId: 'two', from: 'bob@example.com', subject: 'Second', receivedAt: '1970-01-01T00:00:01.000Z', description: 'Description 2', suggestedCategory: 'Newsletters', categoryStatus: 'suggested-new' },
        { messageId: 'one', from: 'alice@example.com', subject: 'First', receivedAt: '1970-01-01T00:00:00.000Z', description: 'Description 1', suggestedCategory: 'Work', categoryStatus: 'suggested-existing' },
      ])
      assert.equal(prompts.length, 2)
      assert.match(prompts[0], /Hello/)
      assert.match(prompts[1], /World/)
      assert.deepEqual(toolRequests.map((request) => request.tools.map((tool) => tool.name)), [['suggest_new_category', 'confirm_existing_category'], ['suggest_new_category', 'confirm_existing_category']])
      const saved = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluations`)
      assert.deepEqual((await saved.json() as { result: Array<{ messageId: string }> }).result.map((email) => email.messageId), ['two', 'one'])
      const nextBatch = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluate-inbox`, { method: 'POST' })
      assert.deepEqual((await nextBatch.json() as { result: { evaluations: unknown[] } }).result.evaluations, [])
      const confirmation = await fetch(`${baseUrl}/api/plugins/email-assistant/confirm-category`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: 'Newsletters', messageId: 'two' }) })
      assert.deepEqual(await confirmation.json(), { result: { category: 'Newsletters', promptProposal: 'Description 3' } })
      assert.match(prompts[2] ?? '', /Choose the best category using one provided tool call/)
      assert.match(prompts[2] ?? '', /Newly approved category: Newsletters/)
      assert.match(prompts[2] ?? '', /Description 2/)
      await fetch(`${baseUrl}/api/plugins/settings/set`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: 'email-assistant', id: 'category-actions', value: [{ category: 'Work', actions: ['mark-read', 'trash'] }] }) })
      const workConfirmation = await fetch(`${baseUrl}/api/plugins/email-assistant/confirm-category`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: 'Work', messageId: 'one' }) })
      assert.deepEqual(await workConfirmation.json(), { result: { category: 'Work', suggestedActions: ['mark-read', 'trash'] } })
      const applied = await fetch(`${baseUrl}/api/plugins/email-assistant/apply-action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 'one' }) })
      assert.deepEqual((await applied.json() as { result: { actions: string[] } }).result.actions, ['mark-read', 'trash'])
      assert.deepEqual(gmailActions, [
        { url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/one/modify', body: JSON.stringify({ addLabelIds: [], removeLabelIds: ['UNREAD'] }) },
        { url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/one/trash', body: undefined },
      ])
      const confirmed = await fetch(`${baseUrl}/api/plugins/email-assistant/evaluations`)
      assert.deepEqual((await confirmed.json() as { result: Array<{ messageId: string; category?: string; suggestedCategory?: string }> }).result.find((email) => email.messageId === 'two'), { messageId: 'two', from: 'bob@example.com', subject: 'Second', receivedAt: '1970-01-01T00:00:01.000Z', description: 'Description 2', category: 'Newsletters', categoryStatus: 'confirmed', categoryPromptProposal: 'Description 3' })
      const settings = await fetch(`${baseUrl}/api/plugins/settings/list`, { method: 'POST' })
      const categories = (await settings.json() as { result: { settings: Array<{ id: string; value: unknown }> } }).result.settings.find((setting) => setting.id === 'categories')
      assert.deepEqual(categories?.value, ['Work', 'Personal', 'Newsletters'])
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
  it("migrates legacy email-category objects to strings", async () => {
    const storage = temporarySecretFile()
    writeFileSync(storage.path, JSON.stringify({
      "email-assistant:categories": [{ name: " Work ", action: "archive" }, "Personal", {}],
    }))
    const server = createJojoClawServer({
      provider: { generate: async () => ({ text: "unused", model: "test" }) },
      plugins: [createEmailAssistantPlugin()],
      settingsFilePath: storage.path,
    }).listen(0)
    await once(server, "listening")
    const address = server.address(); assert(address && typeof address !== "string")
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/plugins/settings/list`, { method: "POST" })
      const settings = (await response.json() as { result: { settings: Array<{ id: string; value: unknown }> } }).result.settings
      assert.deepEqual(settings.find((setting) => setting.id === "categories")?.value, ["Work", "Personal"])
      assert.deepEqual(JSON.parse(readFileSync(storage.path, "utf8"))["email-assistant:categories"], ["Work", "Personal"])
    } finally { server.close(); await once(server, "close"); rmSync(storage.directory, { recursive: true, force: true }) }
  })

})
