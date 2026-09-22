import { type FormEvent, useState } from 'react'

interface ToolCallView {
  name: string
  arguments: Record<string, unknown>
  result: string
}

interface RunResult {
  result: { text: string; model: string; calls: ToolCallView[] }
}

export default function ToolCallingPage() {
  const [prompt, setPrompt] = useState('What is (125 * 8) / 4? Use the calculator.')
  const [result, setResult] = useState<RunResult['result']>()
  const [error, setError] = useState<string>()
  const [isRunning, setIsRunning] = useState(false)

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsRunning(true)
    setResult(undefined)
    setError(undefined)
    try {
      setResult(await requestToolRun(prompt))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unexpected error.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <section className="conversation">
      <ToolCallingIntro />
      <form onSubmit={run} className="composer">
        <label>
          Prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            required
          />
        </label>
        <div className="composer-footer">
          <span>Tool: <strong>calculate</strong></span>
          <button type="submit" disabled={isRunning}>
            {isRunning ? 'Running…' : 'Run'} <span>↑</span>
          </button>
        </div>
      </form>
      {error && <div className="notice error">{error}</div>}
      {result && <ToolCallingResponse result={result} />}
    </section>
  )
}

function ToolCallingIntro() {
  return (
    <div className="intro">
      <div className="plugin-icon">⌘</div>
      <div>
        <h2>Ask an agent with tools</h2>
        <p>The model can request the local calculator; results return for its final answer.</p>
      </div>
    </div>
  )
}

function ToolCallingResponse({ result }: RunResult) {
  return (
    <article className="response">
      <div className="response-meta">
        <span className="assistant-mark">J</span>
        <span>Tool-calling response</span>
        <span className="model">{result.model}</span>
      </div>
      {result.calls.map((call, index) => (
        <p key={index}>
          <code>{call.name}({JSON.stringify(call.arguments)})</code> → {call.result}
        </p>
      ))}
      <p>{result.text}</p>
    </article>
  )
}

async function requestToolRun(prompt: string): Promise<RunResult['result']> {
  const response = await fetch('/api/plugins/tool-calling/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  const payload = await response.json() as RunResult | { error: string }
  if (!response.ok || 'error' in payload)
    throw new Error('error' in payload ? payload.error : 'Tool call failed.')
  return payload.result
}
