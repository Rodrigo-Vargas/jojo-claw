import type { SecretDefinition } from '@jojo-claw/core'

export interface ManagedSecret extends SecretDefinition {
  pluginId: string
  configured: boolean
}

/** Keeps registered secret values private to the server process. */
export class SecretRegistry {
  private readonly definitions = new Map<string, ManagedSecret>()
  private readonly values = new Map<string, string>()

  register(pluginId: string, secret: SecretDefinition): void {
    if (!secret.id || !secret.name) throw new Error('Secret id and name are required.')
    const key = secretKey(pluginId, secret.id)
    if (this.definitions.has(key)) throw new Error(`Duplicate secret: ${key}`)
    this.definitions.set(key, { ...secret, pluginId, configured: false })
  }

  get(pluginId: string, id: string): string | undefined {
    return this.values.get(secretKey(pluginId, id))
  }

  list(): ManagedSecret[] {
    return [...this.definitions.entries()].map(([key, secret]) => ({ ...secret, configured: this.values.has(key) }))
  }

  set(pluginId: string, id: string, value: string): void {
    const key = secretKey(pluginId, id)
    if (!this.definitions.has(key)) throw new Error('Unknown secret.')
    if (value) this.values.set(key, value)
    else this.values.delete(key)
  }
}

function secretKey(pluginId: string, id: string): string { return `${pluginId}:${id}` }
