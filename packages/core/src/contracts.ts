import type { ComponentType } from 'react'

/** Metadata for a plugin installed as a local Node package. */
export interface PluginManifest {
  id: string
  name: string
  description: string
}

/** The only AI capability exposed in this first platform slice. */
export interface GenerateTextInput {
  prompt: string
  system?: string
  model?: string
}

export interface GenerateTextResult {
  text: string
  model: string
}

/** A JSON-schema-shaped description of a function the model may request. */
export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSettingValue
}

/** A provider-issued request to run one registered tool. */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, JsonSettingValue>
}

export type ToolMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string }

export interface GenerateWithToolsInput {
  messages: ToolMessage[]
  tools: ToolDefinition[]
  model?: string
}

export interface GenerateWithToolsResult extends GenerateTextResult {
  toolCalls: ToolCall[]
}

export interface LlmProvider {
  generate(input: GenerateTextInput): Promise<GenerateTextResult>
  generateWithTools?(input: GenerateWithToolsInput): Promise<GenerateWithToolsResult>
}

export interface EmailAssistantConnection {
  accessToken: string
  refreshToken: string
  expiryDate: number
  grantedScopes: string
  email: string | null
}

export interface EmailAssistantOAuthTransaction {
  codeVerifier: string
  createdAt: number
}

export interface EmailAssistantEvaluation {
  messageId: string
  from: string
  subject: string
  receivedAt: string
  description: string
  category?: string
  suggestedCategory?: string
  categoryStatus: 'processing' | 'suggested-new' | 'suggested-existing' | 'confirmed' | 'failed'
  categoryError?: string
  suggestedAction?: string
  actionAppliedAt?: string
}

/** Persistence operations owned and implemented by the database platform plugin. */
export interface DatabaseOperations {
  emailAssistant: {
    getConnection(): EmailAssistantConnection | undefined
    saveConnection(connection: EmailAssistantConnection): void
    deleteConnection(): void
    deleteExpiredOAuthTransactions(before: number): void
    createOAuthTransaction(state: string, transaction: EmailAssistantOAuthTransaction): void
    consumeOAuthTransaction(state: string): EmailAssistantOAuthTransaction | undefined
    listEvaluations(): EmailAssistantEvaluation[]
    saveEvaluation(evaluation: EmailAssistantEvaluation): void
    confirmEvaluationCategory(
      messageId: string,
      category: string,
      suggestedAction?: string,
    ): void
    saveCategorySuggestion(
      messageId: string,
      category: string,
      status: 'suggested-new' | 'suggested-existing',
    ): void
    failCategoryEvaluation(messageId: string, error: string): void
    markEvaluationActionApplied(messageId: string, appliedAt: string): void
  }
}

/** A secret that a plugin needs the local user to provide. */
export interface SecretDefinition {
  id: string
  name: string
  description?: string
}

export type JsonSettingValue = null | boolean | number | string | JsonSettingValue[] | {
  [key: string]: JsonSettingValue
}
export type PluginSettingValue = boolean | number | string | string[] | JsonSettingValue
export type PluginSettingType = 'boolean' | 'number' | 'string' | 'string-list' | 'json' | 'list'

/** A typed preference that a plugin asks the platform to persist for the local user. */
export interface PluginSettingDefinition {
  id: string
  name: string
  description?: string
  type: PluginSettingType
  defaultValue: PluginSettingValue
}

/** A route contributed by an installed plugin package. */
export interface PluginRoute {
  method: 'GET' | 'POST'
  path: string
  handle(input: PluginRouteInput): Promise<unknown | PluginRouteRedirect>
}

/** The normalized request data exposed to a plugin route. */
export interface PluginRouteInput {
  method: 'GET' | 'POST'
  query: Readonly<Record<string, string>>
  body: unknown
}

/** A plugin route can complete an OAuth-style browser flow with a local redirect. */
export interface PluginRouteRedirect {
  type: 'redirect'
  location: string
  status?: 302 | 303
}

export function pluginRedirect(location: string, status: 302 | 303 = 302): PluginRouteRedirect {
  return { type: 'redirect', location, status }
}

/** Platform capabilities made available to local plugin packages. */
export interface PluginContext {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>
  generateWithTools(input: GenerateWithToolsInput): Promise<GenerateWithToolsResult>
  database: DatabaseOperations
  registerRoute(route: PluginRoute): void
  registerSecret(secret: SecretDefinition): void
  getSecret(id: string): string | undefined
  registerSetting(setting: PluginSettingDefinition): void
  getSetting(id: string): PluginSettingValue
  setSetting(id: string, value: PluginSettingValue): void
}

/** A Node package that extends the platform at API composition time. */
export interface PlatformPlugin {
  manifest: PluginManifest
  register(context: PluginContext): void
}

/** A browser page contributed by an installed plugin package. */
export interface PluginPage {
  id: string
  title: string
  navLabel: string
  path: string
  component: ComponentType
}

/** Browser capabilities made available to local plugin packages. */
export interface WebPluginContext {
  registerPage(page: PluginPage): void
}

/** A Node package's browser entry point, composed explicitly by the web app. */
export interface WebPlatformPlugin {
  manifest: PluginManifest
  register(context: WebPluginContext): void
}
