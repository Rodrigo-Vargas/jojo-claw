import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { SecretDefinition } from '@jojo-claw/core'

export interface ManagedSecret extends SecretDefinition {
  pluginId: string
  configured: boolean
}

const managedPrefix = 'JOJO_CLAW_SECRET_'
const managedHeader = '# Jojo Claw managed secrets'

/** Keeps plugin secrets in the local, gitignored .env file. */
export class SecretRegistry {
  private readonly definitions = new Map<string, ManagedSecret>()
  private readonly values = new Map<string, string>()

  constructor(private readonly filePath = resolve(process.cwd(), '.env')) {
    this.load()
  }

  register(pluginId: string, secret: SecretDefinition): void {
    if (!secret.id || !secret.name) throw new Error('Secret id and name are required.')
    const key = secretKey(pluginId, secret.id)
    if (this.definitions.has(key)) throw new Error(`Duplicate secret: ${key}`)
    this.definitions.set(key, { ...secret, pluginId, configured: false })
  }

  get(pluginId: string, id: string): string | undefined {
    return this.values.get(secretKey(pluginId, id))
  }

  /** Returns a configured value for the Secrets UI after an explicit reveal action. */
  reveal(pluginId: string, id: string): string | undefined {
    const key = secretKey(pluginId, id)
    if (!this.definitions.has(key)) throw new Error('Unknown secret.')
    return this.values.get(key)
  }

  list(): ManagedSecret[] {
    return [...this.definitions.entries()].map(([key, secret]) => ({ ...secret, configured: this.values.has(key) }))
  }

  set(pluginId: string, id: string, value: string): void {
    const key = secretKey(pluginId, id)
    if (!this.definitions.has(key)) throw new Error('Unknown secret.')
    if (value) this.values.set(key, value)
    else this.values.delete(key)
    this.persist()
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    for (const line of readFileSync(this.filePath, 'utf8').split(/\r?\n/)) {
      const separator = line.indexOf('=')
      if (separator < 0) continue
      const name = line.slice(0, separator)
      if (!name.startsWith(managedPrefix)) continue
      try {
        const key = Buffer.from(name.slice(managedPrefix.length), 'base64url').toString('utf8')
        const value = Buffer.from(line.slice(separator + 1), 'base64url').toString('utf8')
        if (key) this.values.set(key, value)
      } catch { /* Ignore malformed managed values instead of making startup fail. */ }
    }
  }

  private persist(): void {
    const unmanaged = existsSync(this.filePath)
      ? readFileSync(this.filePath, 'utf8').split(/\r?\n/).filter((line) => line !== managedHeader && !line.startsWith(managedPrefix))
      : []
    const managed = [...this.values.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${managedPrefix}${Buffer.from(key).toString('base64url')}=${Buffer.from(value).toString('base64url')}`)
    const prefix = unmanaged.join('\n').trimEnd()
    const content = managed.length ? `${prefix ? `${prefix}\n\n` : ''}${managedHeader}\n${managed.join('\n')}\n` : `${prefix}${prefix ? '\n' : ''}`
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, content, { encoding: 'utf8', mode: 0o600 })
    chmodSync(this.filePath, 0o600)
  }
}

function secretKey(pluginId: string, id: string): string { return `${pluginId}:${id}` }
