import type { PluginManifest } from '@jojo-claw/core'

export const toolCallingPluginManifest: PluginManifest = {
  id: 'tool-calling',
  name: 'Tool calling',
  description: 'Lets the model request safe local tools and use their results.',
}
