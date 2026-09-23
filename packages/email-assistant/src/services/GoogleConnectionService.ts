import { createHash, randomBytes } from "node:crypto";
import { EmailAssistantRepository } from "../EmailAssistantRepository.js";

const gmailModifyScope = "https://www.googleapis.com/auth/gmail.modify";
const userinfoEmailScope = "https://www.googleapis.com/auth/userinfo.email";
const transactionLifetimeMs = 10 * 60 * 1_000;

interface OAuthConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface ConnectionInput {
  accessToken: string;
  refreshToken: string;
  expiresIn: number | undefined;
  grantedScopes: string;
  email: string | null;
}
export interface GoogleConnectionOptions {
  fetch: typeof fetch;
  repository: EmailAssistantRepository;
  configuration(): OAuthConfiguration;
}

/** Manages Gmail OAuth credentials stored by Email Assistant.
 * Example: `new GoogleConnectionService({ fetch, repository, configuration })`.
 */
export class GoogleConnectionService {
  constructor(private readonly options: GoogleConnectionOptions) {}

  status(): { configured: boolean; connected: boolean; email?: string } {
    const connection = this.options.repository.getConnection();
    const email = connection?.email ? { email: connection.email } : {};
    return { configured: this.isConfigured(), connected: Boolean(connection), ...email };
  }

  authorizationUrl(): string {
    const configuration = this.configuration();
    this.deleteExpiredTransactions();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    this.options.repository.createOAuthTransaction(state, {
      codeVerifier: verifier,
      createdAt: Date.now(),
    });
    return createAuthorizationUrl(configuration, state, verifier);
  }

  async completeAuthorization(query: Readonly<Record<string, string>>): Promise<void> {
    const configuration = this.configuration();
    validateAuthorizationQuery(query);
    const transaction = this.options.repository.consumeOAuthTransaction(query.state);
    if (!transaction || transaction.createdAt < Date.now() - transactionLifetimeMs) {
      throw new Error("The Google authorization request expired. Start the connection again.");
    }
    const token = await this.tokenRequest(configuration, {
      code: query.code,
      code_verifier: transaction.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: configuration.redirectUri,
    });
    if (!hasCompleteGmailToken(token)) {
      throw new Error(
        "Google did not grant Gmail modify access. Reconnect and approve the requested permission.",
      );
    }
    const email = await this.accountEmail(token.access_token);
    this.saveConnection({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      grantedScopes: token.scope ?? "",
      email,
    });
  }

  async accessToken(): Promise<string> {
    const connection = this.options.repository.getConnection();
    if (!connection) {
      throw new Error("Gmail is not connected. Connect Gmail before evaluating the inbox.");
    }
    if (!hasGmailModifyScope(connection.grantedScopes)) {
      throw new Error(
        "Gmail modify access is required. Reconnect Gmail and approve the updated permission.",
      );
    }
    if (connection.expiryDate > Date.now() + 60_000) return connection.accessToken;
    const token = await this.tokenRequest(this.configuration(), {
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    });
    if (!token.access_token) throw new Error("Google did not return a refreshed access token.");
    this.saveConnection({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? connection.refreshToken,
      expiresIn: token.expires_in,
      grantedScopes: token.scope ?? connection.grantedScopes,
      email: connection.email,
    });
    return token.access_token;
  }

  async disconnect(): Promise<{ connected: false }> {
    const connection = this.options.repository.getConnection();
    if (connection) await revokeConnection(this.options.fetch, connection.accessToken);
    this.options.repository.deleteConnection();
    return { connected: false };
  }

  private deleteExpiredTransactions(): void {
    this.options.repository.deleteExpiredOAuthTransactions(Date.now() - transactionLifetimeMs);
  }

  private isConfigured(): boolean {
    return Boolean(this.options.configuration().clientId);
  }

  private configuration(): OAuthConfiguration {
    const configuration = this.options.configuration();
    if (!configuration.clientId) {
      throw new Error("Set the Google OAuth client ID in Secrets before connecting Gmail.");
    }
    return configuration;
  }

  private async tokenRequest(
    configuration: OAuthConfiguration,
    parameters: Record<string, string>,
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      client_id: configuration.clientId,
      ...(configuration.clientSecret ? { client_secret: configuration.clientSecret } : {}),
      ...parameters,
    });
    const response = await this.options.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const token = (await response.json()) as OAuthTokenResponse;
    if (!response.ok) {
      throw new Error(token.error_description ?? token.error ?? tokenErrorMessage(response));
    }
    return token;
  }

  private async accountEmail(accessToken: string): Promise<string | null> {
    const response = await this.options.fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return ((await response.json()) as { email?: string }).email ?? null;
  }

  private saveConnection(input: ConnectionInput): void {
    this.options.repository.saveConnection({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiryDate: Date.now() + (input.expiresIn ?? 3600) * 1_000,
      grantedScopes: input.grantedScopes,
      email: input.email,
    });
  }
}

function hasCompleteGmailToken(token: OAuthTokenResponse): token is OAuthTokenResponse & {
  access_token: string;
  refresh_token: string;
} {
  return hasGmailModifyScope(token.scope) && Boolean(token.access_token && token.refresh_token);
}

function tokenErrorMessage(response: Response): string {
  return `Google token exchange failed: HTTP ${response.status}.`;
}

function createAuthorizationUrl(
  configuration: OAuthConfiguration,
  state: string,
  verifier: string,
): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: configuration.clientId,
    redirect_uri: configuration.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: `${gmailModifyScope} ${userinfoEmailScope}`,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

function validateAuthorizationQuery(
  query: Readonly<Record<string, string>>,
): asserts query is Readonly<Record<string, string>> & { code: string; state: string } {
  if (query.error) throw new Error(`Google authorization was not completed: ${query.error}.`);
  if (!query.code || !query.state) {
    throw new Error("Google did not return an authorization code and state.");
  }
}

function hasGmailModifyScope(scopes: string | undefined): boolean {
  return scopes?.split(/\s+/).includes(gmailModifyScope) ?? false;
}

async function revokeConnection(request: typeof fetch, accessToken: string): Promise<void> {
  try {
    const url = `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`;
    await request(url, { method: "POST" });
  } catch {
    /* Local disconnect must not depend on Google availability. */
  }
}
