import { FormEvent, useEffect, useState } from 'react'

interface ManagedSecret { pluginId: string; id: string; name: string; description?: string; configured: boolean }

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<ManagedSecret[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  async function load() {
    const response = await fetch('/api/plugins/secrets/list', { method: 'POST' })
    if (!response.ok) throw new Error(await messageFrom(response))
    const result = await response.json() as { result: { secrets: ManagedSecret[] } }
    setSecrets(result.result.secrets)
  }

  useEffect(() => { void load().catch((cause: unknown) => setError(messageOf(cause))) }, [])

  async function save(event: FormEvent<HTMLFormElement>, secret: ManagedSecret) {
    event.preventDefault()
    setMessage(undefined); setError(undefined)
    const value = values[keyOf(secret)] ?? ''
    try {
      const response = await fetch('/api/plugins/secrets/set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: secret.pluginId, id: secret.id, value }) })
      if (!response.ok) throw new Error(await messageFrom(response))
      await load()
      setValues((current) => ({ ...current, [keyOf(secret)]: '' }))
      setMessage(value ? `${secret.name} saved.` : `${secret.name} cleared.`)
    } catch (cause) { setError(messageOf(cause)) }
  }

  return <section className="conversation secrets-page">
    <div className="intro"><div className="plugin-icon">⌘</div><div><h2>Plugin secrets</h2><p>Secrets stay in the local API process and are never sent back to this page.</p></div></div>
    {secrets.length === 0 && !error && <p className="muted">No installed plugin has requested a secret.</p>}
    <div className="secrets-list">{secrets.map((secret) => <form className="secret-card" key={keyOf(secret)} onSubmit={(event) => void save(event, secret)}>
      <div><strong>{secret.name}</strong><code>{secret.pluginId}/{secret.id}</code>{secret.description && <p>{secret.description}</p>}</div>
      <span className={`secret-status${secret.configured ? ' configured' : ''}`}>{secret.configured ? 'Configured' : 'Not configured'}</span>
      <label>New value<input type="password" autoComplete="off" value={values[keyOf(secret)] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [keyOf(secret)]: event.target.value }))} placeholder={secret.configured ? 'Leave blank to clear' : 'Enter a value'} /></label>
      <button type="submit">{(values[keyOf(secret)] ?? '') ? 'Save secret' : 'Clear secret'}</button>
    </form>)}</div>
    {message && <div className="notice success">{message}</div>}{error && <div className="notice error">{error}</div>}
  </section>
}

function keyOf(secret: ManagedSecret): string { return `${secret.pluginId}:${secret.id}` }
function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : 'Unexpected error.' }
async function messageFrom(response: Response): Promise<string> { const body = await response.json() as { error?: string }; return body.error ?? 'Request failed.' }
