import { type FormEvent, useState } from 'react'

interface GenerateResult { result: { text: string; model: string } }

export default function TextGenerationPage() {
  const [prompt, setPrompt] = useState('Explain why a local plugin boundary is useful in two sentences.')
  const [system, setSystem] = useState('Be concise and practical.')
  const [result, setResult] = useState<GenerateResult['result']>()
  const [error, setError] = useState<string>()
  const [isRunning, setIsRunning] = useState(false)

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsRunning(true)
    setError(undefined)
    setResult(undefined)
    try {
      const response = await fetch('/api/plugins/text/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, system }),
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

  return <section className="conversation">
    <div className="intro"><div className="plugin-icon">✦</div><div><h2>Ask the text plugin</h2><p>This local package calls the platform-managed Ollama provider. No plugin configuration or provider credentials required.</p></div></div>
    <form onSubmit={generate} className="composer">
      <label>System guidance
        <textarea value={system} onChange={(event) => setSystem(event.target.value)} rows={2} />
      </label>
      <label>Prompt
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
          required
        />
      </label>
      <div className="composer-footer"><span>Powered by <strong>@jojo-claw/text-plugin</strong></span><button type="submit" disabled={isRunning}>{isRunning ? 'Generating…' : 'Generate'} <span>↑</span></button></div>
    </form>
    {error && <div className="notice error">{error}</div>}
    {result && <article className="response"><div className="response-meta"><span className="assistant-mark">J</span><span>Text generation</span><span className="model">{result.model}</span></div><p>{result.text}</p></article>}
  </section>
}

function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : 'Unexpected error.' }
