import type { PlatformPlugin } from '@jojo-claw/core'
import { runToolCallingAgent, type ToolExecutor } from './agent.js'
import { calculate, calculatorTool } from './calculator.js'
import { toolCallingPluginManifest } from './manifest.js'
import { setPromptContent, setPromptTool } from './prompt.js'

export { runToolCallingAgent } from './agent.js'
export { calculate, calculatorTool } from './calculator.js'
export { setPromptContent, setPromptTool, type PromptEditor } from './prompt.js'

/** Adds a safe, observable model-to-tool loop to the local platform. */
export const toolCallingPlugin: PlatformPlugin = {
  manifest: toolCallingPluginManifest,
  register(context) {
    context.registerRoute({
      method: 'POST',
      path: '/run',
      async handle({ body }) {
        if (!isRunInput(body))
          throw new Error('prompt is required and must be a string.')
        return runToolCallingAgent(
          context,
          body.prompt,
          [calculatorTool, setPromptTool],
          new Map<string, ToolExecutor>([
            ['calculate', calculate],
            ['set_prompt', (argumentsValue) => setPromptContent(context, argumentsValue)],
          ]),
        )
      },
    })
  },
}

function isRunInput(value: unknown): value is { prompt: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).prompt === 'string'
  )
}
