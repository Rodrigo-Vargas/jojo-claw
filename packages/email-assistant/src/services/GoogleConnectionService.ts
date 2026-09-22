/* eslint-disable max-len, max-params */
import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseOperations } from '@jojo-claw/core'

const gmailReadScope = 'https://www.googleapis.com/auth/gmail.readonly'
const userinfoEmailScope = 'https://www.googleapis.com/auth/userinfo.email'
const transactionLifetimeMs = 10 * 60 * 1_000

interface OAuthConfiguration { clientId: string; clientSecret: string; redirectUri: string }
interface OAuthTokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
export interface GoogleConnectionOptions {
  fetch: typeof fetch
  database: DatabaseOperations
  configuration(): OAuthConfiguration
}

/** Manages Gmail OAuth credentials stored by the platform database.
 * Example: `new GoogleConnectionService({ fetch, database, configuration })`.
 */
export class GoogleConnectionService {
  constructor(private readonly options: GoogleConnectionOptions) {}

  status(): { configured: boolean; connected: boolean; email?: string } {
    const connection = this.options.database.emailAssistant.getConnection()
    return { configured: this.isConfigured(), connected: Boolean(connection), ...(connection?.email ? { email: connection.email } : {}) }
  }

  authorizationUrl(): string {
    const configuration = this.configuration()
    this.options.database.emailAssistant.deleteExpiredOAuthTransactions(Date.now() - transactionLifetimeMs)
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    this.options.database.emailAssistant.createOAuthTransaction(state, { codeVerifier: verifier, createdAt: Date.now() })
    return createAuthorizationUrl(configuration, state, verifier)
  }

  async completeAuthorization(query: Readonly<Record<string, string>>): Promise<void> {
    const configuration = this.configuration()
    validateAuthorizationQuery(query)
    const transaction = this.options.database.emailAssistant.consumeOAuthTransaction(query.state)
    if (!transaction || transaction.createdAt < Date.now() - transactionLifetimeMs) throw new Error('The Google authorization request expired. Start the connection again.')
    const token = await this.tokenRequest(configuration, { code: query.code, code_verifier: transaction.codeVerifier, grant_type: 'authorization_code', redirect_uri: configuration.redirectUri })
    if (!hasGmailReadScope(token.scope) || !token.access_token || !token.refresh_token) throw new Error('Google did not grant durable Gmail read access. Reconnect and approve the requested permission.')
    this.saveConnection(token.access_token, token.refresh_token, token.expires_in, token.scope ?? '', await this.accountEmail(token.access_token))
  }

  async accessToken(): Promise<string> {
    const configuration = this.configuration()
    const connection = this.options.database.emailAssistant.getConnection()
    if (!connection) throw new Error('Gmail is not connected. Connect Gmail before evaluating the inbox.')
    if (!hasGmailReadScope(connection.grantedScopes)) throw new Error('The Gmail connection no longer has read access. Reconnect Gmail.')
    if (connection.expiryDate > Date.now() + 60_000) return connection.accessToken
    const token = await this.tokenRequest(configuration, { refresh_token: connection.refreshToken, grant_type: 'refresh_token' })
    if (!token.access_token) throw new Error('Google did not return a refreshed access token.')
    this.saveConnection(token.access_token, token.refresh_token ?? connection.refreshToken, token.expires_in, token.scope ?? connection.grantedScopes, connection.email)
    return token.access_token
  }

  async disconnect(): Promise<{ connected: false }> {
    const connection = this.options.database.emailAssistant.getConnection()
    if (connection) await revokeConnection(this.options.fetch, connection.accessToken)
    this.options.database.emailAssistant.deleteConnection()
    return { connected: false }
  }

  private isConfigured(): boolean { return Boolean(this.options.configuration().clientId) }

  private configuration(): OAuthConfiguration {
    const configuration = this.options.configuration()
    if (!configuration.clientId) throw new Error('Set the Google OAuth client ID in Secrets before connecting Gmail.')
    return configuration
  }

  private async tokenRequest(configuration: OAuthConfiguration, parameters: Record<string, string>): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({ client_id: configuration.clientId, ...(configuration.clientSecret ? { client_secret: configuration.clientSecret } : {}), ...parameters })
    const response = await this.options.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    const token = await response.json() as OAuthTokenResponse
    if (!response.ok) throw new Error(token.error_description ?? token.error ?? `Google token exchange failed: HTTP ${response.status}.`)
    return token
  }

  private async accountEmail(accessToken: string): Promise<string | null> {
    const response = await this.options.fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${accessToken}` } })
    return response.ok ? ((await response.json()) as { email?: string }).email ?? null : null
  }

  private saveConnection(accessToken: string, refreshToken: string, expiresIn: number | undefined, grantedScopes: string, email: string | null): void {
    this.options.database.emailAssistant.saveConnection({ accessToken, refreshToken, expiryDate: Date.now() + (expiresIn ?? 3600) * 1_000, grantedScopes, email })
  }
}

function createAuthorizationUrl(configuration: OAuthConfiguration, state: string, verifier: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: configuration.clientId, redirect_uri: configuration.redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: `${gmailReadScope} ${userinfoEmailScope}`, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
  return url.toString()
}
function validateAuthorizationQuery(query: Readonly<Record<string, string>>): asserts query is Readonly<Record<string, string>> & { code: string; state: string } {
  if (query.error) throw new Error(`Google authorization was not completed: ${query.error}.`)
  if (!query.code || !query.state) throw new Error('Google did not return an authorization code and state.')
}
function hasGmailReadScope(scopes: string | undefined): boolean { return scopes?.split(/\s+/).includes(gmailReadScope) ?? false }
async function revokeConnection(request: typeof fetch, accessToken: string): Promise<void> { try { await request(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: 'POST' }) } catch { /* Local disconnect must not depend on Google's availability. */ } }
