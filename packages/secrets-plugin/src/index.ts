import type { PlatformPlugin } from '@jojo-claw/core'
import { secretsPluginManifest } from './manifest.js'
import { SecretRegistry } from './registry.js'

export { SecretRegistry, type ManagedSecret } from './registry.js'

/** Creates the built-in plugin that manages locally registered secrets. */
export function createSecretsPlugin(secrets: SecretRegistry): PlatformPlugin {
  return {
    manifest: secretsPluginManifest,
    register(context) {
      context.registerRoute({
        method: 'POST',
        path: '/list',
        async handle() { return { secrets: secrets.list() } },
      })
      context.registerRoute({
        method: 'POST',
        path: '/set',
        async handle({ body }) {
          if (!isSetSecretInput(body)) throw new Error('pluginId, id, and value are required strings.')
          secrets.set(body.pluginId, body.id, body.value)
          return { configured: Boolean(body.value) }
        },
      })
      context.registerRoute({
        method: 'POST',
        path: '/reveal',
        async handle({ body }) {
          if (!isSecretReference(body)) throw new Error('pluginId and id are required strings.')
          return { value: secrets.reveal(body.pluginId, body.id) }
        },
      })
    },
  }
}

function isSetSecretInput(
  value: unknown,
): value is { pluginId: string; id: string; value: string } {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  return typeof input.pluginId === 'string' && typeof input.id === 'string' && typeof input.value === 'string'
}

function isSecretReference(value: unknown): value is { pluginId: string; id: string } {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  return typeof input.pluginId === 'string' && typeof input.id === 'string'
}
