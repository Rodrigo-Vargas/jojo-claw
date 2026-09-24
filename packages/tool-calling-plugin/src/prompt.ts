import type { JsonSettingValue, ToolDefinition } from '@jojo-claw/core'

export interface PromptEditor {
  setPrompt(pluginId: string, id: string, content: string): void
}

export const setPromptTool: ToolDefinition = {
  name: 'set_prompt',
  description:
    'Replaces the content of a registered prompt. Use the plugin ID and prompt ID '
    + 'supplied by the user.',
  parameters: {
    type: 'object',
    properties: {
      pluginId: { type: 'string', description: 'The plugin that owns the prompt.' },
      id: { type: 'string', description: 'The registered prompt ID.' },
      content: { type: 'string', description: 'The complete replacement prompt content.' },
    },
    required: ['pluginId', 'id', 'content'],
  },
}

/** Persists a model-requested replacement for an existing registered prompt.
 * Example: `setPromptContent(editor, { pluginId: 'text', id: 'instructions',
 * content: 'Be brief.' })`.
 */
export function setPromptContent(
  editor: PromptEditor,
  argumentsValue: Record<string, JsonSettingValue>,
): { pluginId: string; id: string; content: string } {
  const input = promptUpdateInput(argumentsValue)
  editor.setPrompt(input.pluginId, input.id, input.content)
  return input
}

function promptUpdateInput(
  value: Record<string, JsonSettingValue>,
): { pluginId: string; id: string; content: string } {
  const { pluginId, id, content } = value
  if (typeof pluginId !== 'string' || !pluginId.trim())
    throw new Error(
      `set_prompt received pluginId ${JSON.stringify(pluginId)}; expected a non-empty string.`,
    )
  if (typeof id !== 'string' || !id.trim())
    throw new Error(`set_prompt received id ${JSON.stringify(id)}; expected a non-empty string.`)
  if (typeof content !== 'string')
    throw new Error(`set_prompt received content ${JSON.stringify(content)}; expected a string.`)
  return { pluginId, id, content }
}
