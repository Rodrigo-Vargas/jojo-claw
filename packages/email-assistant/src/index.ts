import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pluginRedirect, type PlatformPlugin } from '@jojo-claw/core'
import { emailAssistantPluginManifest } from './manifest.js'

const gmailApiBaseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me'
const gmailReadScope = 'https://www.googleapis.com/auth/gmail.readonly'
const userinfoEmailScope = 'https://www.googleapis.com/auth/userinfo.email'
const maxInboxMessages = 10
const maxEmailCharacters = 6_000
const transactionLifetimeMs = 10 * 60 * 1_000

export interface EmailEvaluation {
  messageId: string
  from: string
  subject: string
  receivedAt: string
  description: string
}
export interface EmailAssistantOptions {
  fetch?: typeof fetch
  storagePath?: string
  oauth?: { clientId?: string; clientSecret?: string; redirectUri?: string; encryptionKey?: Buffer }
}

/** A local Gmail OAuth connection plus a bounded inbox-evaluation workflow. */
export function createEmailAssistantPlugin(options: EmailAssistantOptions = {}): PlatformPlugin {
  const request = options.fetch ?? fetch
  let contextSecrets: { get(id: string): string | undefined } | undefined
  const service = new GoogleConnectionService({
    fetch: request,
    storagePath: options.storagePath ?? resolve(process.cwd(), '.jojo-claw', 'email-assistant.db'),
    configuration: () => ({
      clientId: options.oauth?.clientId ?? contextSecrets?.get('google-client-id') ?? '',
      clientSecret: options.oauth?.clientSecret ?? contextSecrets?.get('google-client-secret') ?? '',
      redirectUri: options.oauth?.redirectUri ?? process.env.JOJO_GOOGLE_REDIRECT_URI ?? 'http://localhost:8788/api/plugins/email-assistant/oauth/callback',
      encryptionKey: options.oauth?.encryptionKey ?? encryptionKeyFromBase64(contextSecrets?.get('connection-encryption-key')),
    }),
  })

  return {
    manifest: emailAssistantPluginManifest,
    register(context) {
      contextSecrets = { get: (id) => context.getSecret(id) }
      context.registerSecret({ id: 'google-client-id', name: 'Google OAuth client ID', description: 'OAuth client ID configured in Google Cloud for Email assistant.' })
      context.registerSecret({ id: 'google-client-secret', name: 'Google OAuth client secret', description: 'Optional client secret when the selected Google OAuth client requires one.' })
      context.registerSecret({ id: 'connection-encryption-key', name: 'Email Assistant encryption key', description: 'A stable base64-encoded 32-byte key used to encrypt Gmail tokens stored locally.' })
      context.registerRoute({ method: 'GET', path: '/status', async handle() { return service.status() } })
      context.registerRoute({ method: 'GET', path: '/connect', async handle() { return pluginRedirect(service.authorizationUrl()) } })
      context.registerRoute({
        method: 'GET',
        path: '/oauth/callback',
        async handle({ query }) {
          await service.completeAuthorization(query)
          const webUrl = process.env.JOJO_WEB_URL ?? 'http://localhost:5173'
          return pluginRedirect(`${webUrl}/plugins/email-assistant?gmail=connected`)
        },
      })
      context.registerRoute({ method: 'POST', path: '/disconnect', async handle() { return service.disconnect() } })
      context.registerRoute({
        method: 'POST', path: '/evaluate-inbox',
        async handle() {
          const token = await service.accessToken()
          const evaluations: EmailEvaluation[] = []
          for (const messageId of await listInboxMessageIds(request, token)) {
            const email = await readEmail(request, token, messageId)
            const result = await context.generateText({
              system: 'You evaluate one email at a time. Write one concise, neutral description in at most 25 words. Do not use markdown, include personal data beyond what is supplied, or invent facts.',
              prompt: emailPrompt(email),
            })
            evaluations.push({
              messageId: email.messageId,
              from: email.from,
              subject: email.subject,
              receivedAt: email.receivedAt,
              description: result.text.trim(),
            })
          }
          return { evaluations }
        },
      })
    },
  }
}

interface OAuthConfiguration {
  clientId: string
  clientSecret: string
  redirectUri: string
  encryptionKey?: Buffer
}
interface GoogleConnectionOptions {
  fetch: typeof fetch
  storagePath: string
  configuration: () => OAuthConfiguration
}
interface StoredConnection {
  access_token: string
  refresh_token: string
  expiry_date: number
  granted_scopes: string
  email: string | null
}
interface OAuthTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

class GoogleConnectionService {
  private readonly database: DatabaseSync
  constructor(private readonly options: GoogleConnectionOptions) {
    if (options.storagePath !== ':memory:') mkdirSync(dirname(options.storagePath), { recursive: true })
    this.database = new DatabaseSync(options.storagePath)
    this.database.exec(`CREATE TABLE IF NOT EXISTS email_assistant_connection (id INTEGER PRIMARY KEY CHECK (id = 1), access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, expiry_date INTEGER NOT NULL, granted_scopes TEXT NOT NULL, email TEXT); CREATE TABLE IF NOT EXISTS email_assistant_oauth_transaction (state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, created_at INTEGER NOT NULL)`)
  }
  status(): { configured: boolean; connected: boolean; email?: string } {
    const row = this.database.prepare('SELECT email FROM email_assistant_connection WHERE id = 1').get() as { email: string | null } | undefined
    return { configured: this.configured(), connected: Boolean(row), ...(row?.email ? { email: row.email } : {}) }
  }
  authorizationUrl(): string {
    const configuration = this.assertConfigured()
    this.database.prepare('DELETE FROM email_assistant_oauth_transaction WHERE created_at < ?').run(Date.now() - transactionLifetimeMs)
    const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url')
    this.database.prepare('INSERT INTO email_assistant_oauth_transaction (state, code_verifier, created_at) VALUES (?, ?, ?)').run(state, verifier, Date.now())
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({ client_id: configuration.clientId, redirect_uri: configuration.redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: `${gmailReadScope} ${userinfoEmailScope}`, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
    return url.toString()
  }
  async completeAuthorization(query: Readonly<Record<string, string>>): Promise<void> {
    const configuration = this.assertConfigured()
    if (query.error) throw new Error(`Google authorization was not completed: ${query.error}.`)
    if (!query.code || !query.state) throw new Error('Google did not return an authorization code and state.')
    const transaction = this.database.prepare('SELECT code_verifier, created_at FROM email_assistant_oauth_transaction WHERE state = ?').get(query.state) as { code_verifier: string; created_at: number } | undefined
    this.database.prepare('DELETE FROM email_assistant_oauth_transaction WHERE state = ?').run(query.state)
    if (!transaction || transaction.created_at < Date.now() - transactionLifetimeMs) throw new Error('The Google authorization request expired. Start the connection again.')
    const token = await this.tokenRequest(configuration, { code: query.code, code_verifier: transaction.code_verifier, grant_type: 'authorization_code', redirect_uri: configuration.redirectUri })
    if (!hasGmailReadScope(token.scope) || !token.access_token || !token.refresh_token) throw new Error('Google did not grant durable Gmail read access. Reconnect and approve the requested permission.')
    this.saveConnection({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiryDate: Date.now() + (token.expires_in ?? 3600) * 1_000,
      grantedScopes: token.scope ?? '',
      email: await this.accountEmail(token.access_token),
    })
  }
  async accessToken(): Promise<string> {
    const configuration = this.assertConfigured(); const connection = this.connection()
    if (!connection) throw new Error('Gmail is not connected. Connect Gmail before evaluating the inbox.')
    if (!hasGmailReadScope(connection.granted_scopes)) throw new Error('The Gmail connection no longer has read access. Reconnect Gmail.')
    const accessToken = this.decrypt(connection.access_token)
    if (connection.expiry_date > Date.now() + 60_000) return accessToken
    const refreshToken = this.decrypt(connection.refresh_token)
    const token = await this.tokenRequest(configuration, { refresh_token: refreshToken, grant_type: 'refresh_token' })
    if (!token.access_token) throw new Error('Google did not return a refreshed access token.')
    this.saveConnection({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiryDate: Date.now() + (token.expires_in ?? 3600) * 1_000,
      grantedScopes: token.scope ?? connection.granted_scopes,
      email: connection.email,
    })
    return token.access_token
  }
  async disconnect(): Promise<{ connected: false }> {
    const connection = this.connection()
    if (connection) { try { await this.options.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(this.decrypt(connection.access_token))}`, { method: 'POST' }) } catch { /* always remove the local connection */ } }
    this.database.prepare('DELETE FROM email_assistant_connection WHERE id = 1').run()
    return { connected: false }
  }
  private configured(): boolean {
    const configuration = this.options.configuration()
    return Boolean(configuration.clientId && configuration.encryptionKey?.length === 32)
  }
  private assertConfigured(): OAuthConfiguration {
    const configuration = this.options.configuration()
    if (!configuration.clientId || configuration.encryptionKey?.length !== 32) {
      throw new Error('Set the Google OAuth client ID and a base64 32-byte Email Assistant encryption key in Secrets before connecting Gmail.')
    }
    return configuration
  }
  private connection(): StoredConnection | undefined { return this.database.prepare('SELECT access_token, refresh_token, expiry_date, granted_scopes, email FROM email_assistant_connection WHERE id = 1').get() as StoredConnection | undefined }
  private async tokenRequest(
    configuration: OAuthConfiguration,
    parameters: Record<string, string>,
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      client_id: configuration.clientId,
      ...(configuration.clientSecret ? { client_secret: configuration.clientSecret } : {}),
      ...parameters,
    })
    const response = await this.options.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    const token = await response.json() as OAuthTokenResponse
    if (!response.ok) throw new Error(token.error_description ?? token.error ?? `Google token exchange failed: HTTP ${response.status}.`)
    return token
  }
  private async accountEmail(accessToken: string): Promise<string | null> { const response = await this.options.fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${accessToken}` } }); return response.ok ? ((await response.json()) as { email?: string }).email ?? null : null }
  private saveConnection(input: { accessToken: string; refreshToken: string; expiryDate: number; grantedScopes: string; email: string | null }): void { this.database.prepare('INSERT INTO email_assistant_connection (id, access_token, refresh_token, expiry_date, granted_scopes, email) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, expiry_date = excluded.expiry_date, granted_scopes = excluded.granted_scopes, email = excluded.email').run(this.encrypt(input.accessToken), this.encrypt(input.refreshToken), input.expiryDate, input.grantedScopes, input.email) }
  private encrypt(value: string): string { const key = this.assertConfigured().encryptionKey!; const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); return `${iv.toString('base64url')}.${Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64url')}.${cipher.getAuthTag().toString('base64url')}` }
  private decrypt(value: string): string { const key = this.assertConfigured().encryptionKey!; const parts = value.split('.'); if (parts.length !== 3) throw new Error('Stored Gmail connection is invalid. Reconnect Gmail.'); const [iv, encrypted, tag] = parts.map((part) => Buffer.from(part, 'base64url')); const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8') }
}

function encryptionKeyFromBase64(value: string | undefined): Buffer | undefined { if (!value) return undefined; const key = Buffer.from(value, 'base64'); return key.length === 32 ? key : undefined }
function hasGmailReadScope(scopes: string | undefined): boolean {
  return scopes?.split(/\s+/).includes(gmailReadScope) ?? false
}
interface GmailEmail { messageId: string; from: string; subject: string; receivedAt: string; body: string }
async function listInboxMessageIds(request: typeof fetch, token: string): Promise<string[]> { const url = new URL(`${gmailApiBaseUrl}/messages`); url.searchParams.set('labelIds', 'INBOX'); url.searchParams.set('maxResults', String(maxInboxMessages)); const payload = await readGmailJson<{ messages?: Array<{ id?: string }> }>(await request(url, { headers: gmailHeaders(token) })); return payload.messages?.flatMap((message) => message.id ? [message.id] : []) ?? [] }
async function readEmail(request: typeof fetch, token: string, messageId: string): Promise<GmailEmail> { const message = await readGmailJson<GmailMessage>(await request(`${gmailApiBaseUrl}/messages/${encodeURIComponent(messageId)}?format=full`, { headers: gmailHeaders(token) })); const headers = message.payload?.headers ?? []; const header = (name: string) => headers.find((entry) => entry.name?.toLowerCase() === name.toLowerCase())?.value ?? ''; return { messageId: message.id ?? messageId, from: header('From'), subject: header('Subject'), receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : '', body: truncate(extractBody(message.payload) || message.snippet || '', maxEmailCharacters) } }
function gmailHeaders(token: string): HeadersInit { return { authorization: `Bearer ${token}` } }
async function readGmailJson<T>(response: Response): Promise<T> { const payload = await response.json() as T & { error?: { message?: string } }; if (!response.ok) throw new Error(payload.error?.message ?? `Gmail returned HTTP ${response.status}.`); return payload }
function emailPrompt(email: GmailEmail): string { return `From: ${email.from}\nSubject: ${email.subject}\nReceived: ${email.receivedAt}\n\nEmail body:\n${email.body}` }
interface GmailMessagePart { mimeType?: string; body?: { data?: string }; parts?: GmailMessagePart[] }
interface GmailMessage {
  id?: string
  internalDate?: string
  snippet?: string
  payload?: GmailMessagePart & { headers?: Array<{ name?: string; value?: string }> }
}
function extractBody(part: GmailMessagePart | undefined): string { if (!part) return ''; const nested = part.parts?.map(extractBody).find(Boolean) ?? ''; if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data); if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(decodeBase64Url(part.body.data)); return nested }
function decodeBase64Url(value: string): string { return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') }
function stripHtml(value: string): string { return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
function truncate(value: string, limit: number): string { return value.length > limit ? `${value.slice(0, limit)}…` : value }
