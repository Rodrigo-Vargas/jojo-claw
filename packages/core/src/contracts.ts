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

export interface LlmProvider {
  generate(input: GenerateTextInput): Promise<GenerateTextResult>
}

/** A route contributed by an installed plugin package. */
export interface PluginRoute {
  method: 'POST'
  path: string
  handle(body: unknown): Promise<unknown>
}

/** Platform capabilities made available to local plugin packages. */
export interface PluginContext {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>
  registerRoute(route: PluginRoute): void
}

/** A Node package that extends the platform at API composition time. */
export interface PlatformPlugin {
  manifest: PluginManifest
  register(context: PluginContext): void
}
