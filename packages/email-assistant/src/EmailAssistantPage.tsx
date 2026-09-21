import { useEffect, useState } from 'react'

interface EmailEvaluation {
  messageId: string
  from: string
  subject: string
  receivedAt: string
  description: string
}

export default function EmailAssistantPage() {
  const [connection, setConnection] = useState<{
    configured: boolean
    connected: boolean
    email?: string
  }>()
  const [evaluations, setEvaluations] = useState<EmailEvaluation[]>()
  const [error, setError] = useState<string>()
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => { void loadConnection() }, [])

  async function loadConnection() {
    try {
      const response = await fetch('/api/plugins/email-assistant/status')
      const payload = await response.json() as {
        result?: { configured: boolean; connected: boolean; email?: string }
      }
      if (response.ok && payload.result) setConnection(payload.result)
    } catch { /* The evaluation action exposes connection failures with a useful message. */ }
  }

  async function evaluateInbox() {
    setIsRunning(true)
    setError(undefined)
    try {
      const response = await fetch(
        '/api/plugins/email-assistant/evaluate-inbox',
        { method: 'POST' },
      )
      const payload = await response.json() as {
        result?: { evaluations: EmailEvaluation[] }
        error?: string
      }
      if (!response.ok || !payload.result) throw new Error(payload.error ?? 'Inbox evaluation failed.')
      setEvaluations(payload.result.evaluations)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inbox evaluation failed.')
    } finally {
      setIsRunning(false)
    }
  }

  return <section className="conversation email-assistant-page">
    <div className="intro"><div className="plugin-icon">✉</div><div><h2>Evaluate your inbox</h2><p>Recent inbox messages are fetched locally and evaluated one at a time. Each result is a concise description.</p></div></div>
    {!connection?.configured && <p className="notice error">Set the Google OAuth client ID in Secrets before connecting Gmail.</p>}
    {connection?.configured && !connection.connected && <a className="evaluate-inbox" href="/api/plugins/email-assistant/connect">Connect Gmail</a>}
    {connection?.connected && <><p className="connection-note">Connected as {connection.email ?? 'your Google account'}.</p><button className="evaluate-inbox" onClick={() => void evaluateInbox()} disabled={isRunning} type="button">{isRunning ? 'Evaluating inbox…' : 'Evaluate inbox'}</button></>}
    {error && <div className="notice error">{error}</div>}
    {evaluations && <div className="email-results"><p className="results-summary">{evaluations.length === 0 ? 'No inbox messages found.' : `${evaluations.length} inbox message${evaluations.length === 1 ? '' : 's'} evaluated.`}</p>
      {evaluations.length > 0 && <div className="table-wrap"><table><thead><tr><th>From</th><th>Subject</th><th>Received</th><th>Description</th></tr></thead><tbody>{evaluations.map((email) => <tr key={email.messageId}><td>{email.from || '—'}</td><td>{email.subject || '—'}</td><td>{formatDate(email.receivedAt)}</td><td>{email.description}</td></tr>)}</tbody></table></div>}
    </div>}
  </section>
}

function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}
