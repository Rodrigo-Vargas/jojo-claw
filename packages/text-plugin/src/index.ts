import type { GenerateTextInput, PlatformPlugin } from '@jojo-claw/core'

/** The first installed package: a thin text-generation capability. */
export const textPlugin: PlatformPlugin = {
  manifest: {
    id: 'text',
    name: 'Text generation',
    description: 'Generates text using the platform-managed LLM provider.',
  },
  register(context) {
    context.registerRoute({
      method: 'POST',
      path: '/generate',
      async handle(body) {
        if (!isGenerateTextInput(body)) throw new Error('prompt is required; system and model must be strings when supplied.')
        return context.generateText(body)
      },
    })
  },
}

function isGenerateTextInput(value: unknown): value is GenerateTextInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  return typeof input.prompt === 'string'
    && (input.system === undefined || typeof input.system === 'string')
    && (input.model === undefined || typeof input.model === 'string')
}
