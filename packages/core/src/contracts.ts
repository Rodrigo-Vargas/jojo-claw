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

/** A secret that a plugin needs the local user to provide. */
export interface SecretDefinition {
  id: string
  name: string
  description?: string
}

export type JsonSettingValue = null | boolean | number | string | JsonSettingValue[] | {
  [key: string]: JsonSettingValue
}

/** Durable JSON records isolated to the plugin that owns them. */
export interface PluginStorage {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
  delete(key: string): void
  entries<T>(): Array<{ key: string; value: T }>
}

/** Platform-owned storage that creates an isolated record collection per plugin. */
export interface StorageOperations {
  forPlugin(pluginId: string): PluginStorage
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
  /** An API path that returns `{ options: string[] }` for a selectable string setting. */
  optionsEndpoint?: string
}

/** A prompt declared by a plugin and editable by the local user. */
export interface PromptDefinition {
  id: string
  name: string
  description?: string
  kind: 'prompt' | 'system'
  defaultContent: string
}

/** Prompt operations made available to installed plugins. */
export interface PromptOperations {
  define(pluginId: string, definition: PromptDefinition): void
  get(pluginId: string, id: string): string
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
  storage: PluginStorage
  registerRoute(route: PluginRoute): void
  registerSecret(secret: SecretDefinition): void
  getSecret(id: string): string | undefined
  registerSetting(setting: PluginSettingDefinition): void
  getSetting(id: string): PluginSettingValue
  setSetting(id: string, value: PluginSettingValue): void
  definePrompt(definition: PromptDefinition): void
  getPrompt(id: string): string
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
