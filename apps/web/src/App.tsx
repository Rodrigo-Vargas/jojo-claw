import { Suspense, useEffect, useState } from 'react'
import { textWebPlugin } from '@jojo-claw/text-plugin/web'
import { secretsWebPlugin } from '@jojo-claw/secrets-plugin/web'
import { mountWebPlugins } from './plugin-registry.js'

interface Plugin { id: string; name: string; description: string }

// Installed browser plugins are deliberately composed here at build time.
const pages = mountWebPlugins([textWebPlugin, secretsWebPlugin])
const defaultPage = pages[0]

export function App() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [error, setError] = useState<string>()
  const [path, setPath] = useState(() => window.location.pathname)
  const page = pages.find((candidate) => candidate.path === path) ?? defaultPage

  useEffect(() => {
    fetch('/api/plugins').then(async (response) => {
      if (!response.ok) throw new Error('Could not load installed plugins.')
      return response.json() as Promise<{ plugins: Plugin[] }>
    }).then(({ plugins }) => setPlugins(plugins)).catch((cause: unknown) => setError(messageOf(cause)))
  }, [])

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigate(nextPath: string) {
    if (nextPath === path) return
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
  }

  const Page = page.component
  return <div className="app-frame">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">J</span><span>Jojo Claw</span></div>
      <button className="new-run" onClick={() => navigate(defaultPage.path)}><span>+</span> New generation</button>
      <div className="nav-label">Plugins</div>
      <nav>{pages.map((candidate) => <a className={`nav-item${candidate.path === page.path ? ' active' : ''}`} href={candidate.path} key={candidate.path} onClick={(event) => { event.preventDefault(); navigate(candidate.path) }}><span>◈</span> {candidate.navLabel}</a>)}</nav>
      <div className="sidebar-foot"><span className="status-dot" /> Local Ollama <span className="gear">⚙</span></div>
    </aside>

    <main className="workspace">
      <header className="topbar"><div><p className="eyebrow">{page.navLabel.toUpperCase()}</p><h1>{page.title}</h1></div><span className="connection">● API connected</span></header>
      <Suspense fallback={<p className="muted">Loading page…</p>}><Page /></Suspense>
    </main>

    <aside className="details"><h2>Installed plugins</h2><p className="details-intro">Packages composed by the local API.</p>{plugins.length === 0 && <p className="muted">Loading plugins…</p>}{plugins.map((plugin) => <article className="plugin-card" key={plugin.id}><div className="plugin-card-title"><span>✦</span><strong>{plugin.name}</strong></div><p>{plugin.description}</p><code>@jojo-claw/{plugin.id}-plugin</code></article>)}{error && <div className="notice error">{error}</div>}<div className="hint"><strong>How it works</strong><p>Packages register API routes and browser pages through explicit host composition.</p></div></aside>
  </div>
}

function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : 'Unexpected error.' }
