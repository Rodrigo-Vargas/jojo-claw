import { type FormEvent, useEffect, useState } from 'react'
import type { PluginSettingValue } from '@jojo-claw/core'

interface ManagedSetting {
  pluginId: string; id: string; name: string; description?: string
  type: 'boolean' | 'number' | 'string' | 'string-list' | 'json'; defaultValue: PluginSettingValue; value: PluginSettingValue
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<ManagedSetting[]>([])
  const [values, setValues] = useState<Record<string, PluginSettingValue>>({})
  const [jsonInputs, setJsonInputs] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string>(); const [error, setError] = useState<string>()
  async function load() {
    const response = await fetch('/api/plugins/settings/list', { method: 'POST' })
    if (!response.ok) throw new Error(await messageFrom(response))
    const payload = await response.json() as {
      result: { settings: ManagedSetting[] }
    }
    setSettings(payload.result.settings)
    setValues(Object.fromEntries(payload.result.settings.map(
      (setting) => [keyOf(setting), setting.value],
    )))
    setJsonInputs(Object.fromEntries(payload.result.settings.filter((setting) => setting.type === 'json').map(
      (setting) => [keyOf(setting), JSON.stringify(setting.value, null, 2)],
    )))
  }
  useEffect(() => { void load().catch((cause: unknown) => setError(messageOf(cause))) }, [])
  async function save(event: FormEvent<HTMLFormElement>, setting: ManagedSetting) {
    event.preventDefault(); setMessage(undefined); setError(undefined)
    try {
      const response = await fetch('/api/plugins/settings/set', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pluginId: setting.pluginId, id: setting.id,
          value: settingValue(setting, values, jsonInputs),
        }),
      })
      if (!response.ok) throw new Error(await messageFrom(response))
      await load(); setMessage(`${setting.name} saved.`)
    } catch (cause) { setError(messageOf(cause)) }
  }
  function updateValue(setting: ManagedSetting, value: PluginSettingValue) {
    setValues({ ...values, [keyOf(setting)]: value })
  }
  return <section className="conversation settings-page">
    <div className="intro"><div className="plugin-icon">⚙</div><div><h2>Plugin settings</h2><p>Configure the preferences registered by locally installed plugins. Changes are stored only on this machine.</p></div></div>
    {settings.length === 0 && !error && <p className="muted">No installed plugin has registered settings.</p>}
    <div className="settings-list">{settings.map((setting) => <form className="setting-card" key={keyOf(setting)} onSubmit={(event) => void save(event, setting)}>
      <div>
        <strong>{setting.name}</strong><code>{setting.pluginId}/{setting.id}</code>
        {setting.description && <p>{setting.description}</p>}
      </div>
      <label>{setting.type === 'boolean' ? <><input checked={values[keyOf(setting)] === true} onChange={(event) => updateValue(setting, event.target.checked)} type="checkbox" /> Enabled</> : setting.type === 'string-list' ? <><span>One value per line</span><textarea value={stringListValue(values[keyOf(setting)])} onChange={(event) => updateValue(setting, parseStringList(event.target.value))} /></> : setting.type === 'json' ? <><span>JSON value</span><textarea value={jsonInputs[keyOf(setting)] ?? ''} onChange={(event) => setJsonInputs({ ...jsonInputs, [keyOf(setting)]: event.target.value })} /></> : <><span>Value</span><input type={setting.type === 'number' ? 'number' : 'text'} value={String(values[keyOf(setting)] ?? '')} onChange={(event) => updateValue(setting, setting.type === 'number' ? Number(event.target.value) : event.target.value)} /></>}</label>
      <button type="submit">Save</button>
    </form>)}</div>
    {message && <div className="notice success">{message}</div>}{error && <div className="notice error">{error}</div>}
  </section>
}
function keyOf(setting: ManagedSetting): string { return `${setting.pluginId}:${setting.id}` }
function stringListValue(value: PluginSettingValue | undefined): string { return Array.isArray(value) ? value.join('\n') : '' }
function parseStringList(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}
function settingValue(
  setting: ManagedSetting,
  values: Record<string, PluginSettingValue>,
  jsonInputs: Record<string, string>,
): PluginSettingValue {
  if (setting.type !== 'json') return values[keyOf(setting)]
  try { return JSON.parse(jsonInputs[keyOf(setting)] ?? '') as PluginSettingValue } catch { throw new Error(`${setting.name} must contain valid JSON.`) }
}
function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : 'Unexpected error.' }
async function messageFrom(response: Response): Promise<string> { const body = await response.json() as { error?: string }; return body.error ?? 'Request failed.' }
