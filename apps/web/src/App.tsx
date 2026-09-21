import { FormEvent, useEffect, useState } from 'react'

interface Plugin { id: string; name: string; description: string }
interface GenerateResult { result: { text: string; model: string } }

export function App() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [prompt, setPrompt] = useState('Explain why a local plugin boundary is useful in two sentences.')
  const [system, setSystem] = useState('Be concise and practical.')
  const [result, setResult] = useState<GenerateResult['result']>()
  const [error, setError] = useState<string>()
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    fetch('/api/plugins').then(async (response) => {
      if (!response.ok) throw new Error('Could not load installed plugins.')
      return response.json() as Promise<{ plugins: Plugin[] }>
    }).then(({ plugins }) => setPlugins(plugins)).catch((cause: unknown) => setError(messageOf(cause)))
  }, [])

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsRunning(true)
    setError(undefined)
    setResult(undefined)
    try {
      const response = await fetch('/api/plugins/text/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, system }),
      })
      const payload = await response.json() as GenerateResult | { error: string }
      if (!response.ok || 'error' in payload) throw new Error('error' in payload ? payload.error : 'Generation failed.')
      setResult(payload.result)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setIsRunning(false)
    }
  }

  return <div className="app-frame">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">J</span><span>Jojo Claw</span></div>
      <button className="new-run" onClick={() => setResult(undefined)}><span>+</span> New generation</button>
      <div className="nav-label">Platform</div>
      <nav><a className="nav-item active" href="#workspace"><span>◈</span> Workspace</a><a className="nav-item" href="#plugins"><span>▦</span> Plugins <b>{plugins.length}</b></a></nav>
      <div className="sidebar-foot"><span className="status-dot" /> Local Ollama <span className="gear">⚙</span></div>
    </aside>

    <main className="workspace" id="workspace">
      <header className="topbar"><div><p className="eyebrow">TEXT PLUGIN</p><h1>New generation</h1></div><span className="connection">● API connected</span></header>
      <section className="conversation">
        <div className="intro"><div className="plugin-icon">✦</div><div><h2>Ask the text plugin</h2><p>This local package calls the platform-managed Ollama provider. No plugin configuration or provider credentials required.</p></div></div>
        <form onSubmit={generate} className="composer">
          <label>System guidance<textarea value={system} onChange={(event) => setSystem(event.target.value)} rows={2} /></label>
          <label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} required /></label>
          <div className="composer-footer"><span>Powered by <strong>@jojo-claw/text-plugin</strong></span><button type="submit" disabled={isRunning}>{isRunning ? 'Generating…' : 'Generate'} <span>↑</span></button></div>
        </form>
        {error && <div className="notice error">{error}</div>}
        {result && <article className="response"><div className="response-meta"><span className="assistant-mark">J</span><span>Text generation</span><span className="model">{result.model}</span></div><p>{result.text}</p></article>}
      </section>
    </main>

    <aside className="details" id="plugins"><h2>Installed plugins</h2><p className="details-intro">Packages composed by the local API.</p>{plugins.length === 0 && <p className="muted">Loading plugins…</p>}{plugins.map((plugin) => <article className="plugin-card" key={plugin.id}><div className="plugin-card-title"><span>✦</span><strong>{plugin.name}</strong></div><p>{plugin.description}</p><code>@jojo-claw/{plugin.id}-plugin</code></article>)}<div className="hint"><strong>How it works</strong><p>Packages register routes and receive only the platform capabilities they need.</p></div></aside>
  </div>
}

function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : 'Unexpected error.' }
