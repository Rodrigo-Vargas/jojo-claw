import type { PlatformPlugin } from '@jojo-claw/core'
import { settingsPluginManifest } from './manifest.js'
import { SettingsRegistry } from './registry.js'

export { SettingsRegistry, type ManagedSetting } from './registry.js'

/** Creates the built-in plugin that collects and persists plugin-owned settings. */
export function createSettingsPlugin(settings: SettingsRegistry): PlatformPlugin {
  return {
    manifest: settingsPluginManifest,
    register(context) {
      context.registerRoute({
        method: 'POST', path: '/list',
        async handle() { return { settings: settings.list() } },
      })
      context.registerRoute({ method: 'POST', path: '/set', async handle({ body }) {
        if (!isSetSettingInput(body)) throw new Error('pluginId and id must be strings.')
        settings.set(body.pluginId, body.id, body.value)
        return { value: settings.get(body.pluginId, body.id) }
      } })
    },
  }
}
function isSetSettingInput(
  value: unknown,
): value is { pluginId: string; id: string; value: unknown } {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  return typeof input.pluginId === 'string' && typeof input.id === 'string' && 'value' in input
}
