/* eslint-disable max-lines-per-function -- This page coordinates plugin settings state. */
import { type FormEvent, useEffect, useState } from "react";
import type {
  JsonSettingValue,
  PluginSettingValue,
  PluginSettingType,
} from "@jojo-claw/core";

interface ManagedSetting {
  pluginId: string;
  id: string;
  name: string;
  description?: string;
  type: PluginSettingType;
  defaultValue: PluginSettingValue;
  value: PluginSettingValue;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<ManagedSetting[]>([]);
  const [values, setValues] = useState<Record<string, PluginSettingValue>>({});
  const [jsonInputs, setJsonInputs] = useState<Record<string, string>>({});
  const [listInputs, setListInputs] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  async function load() {
    const response = await fetch("/api/plugins/settings/list", {
      method: "POST",
    });
    if (!response.ok) throw new Error(await messageFrom(response));
    const payload = (await response.json()) as {
      result: { settings: ManagedSetting[] };
    };
    setSettings(payload.result.settings);
    setValues(
      Object.fromEntries(
        payload.result.settings.map((setting) => [
          keyOf(setting),
          setting.value,
        ]),
      ),
    );
    setJsonInputs(
      Object.fromEntries(
        payload.result.settings
          .filter((setting) => setting.type === "json")
          .map((setting) => [
            keyOf(setting),
            JSON.stringify(setting.value, null, 2),
          ]),
      ),
    );
    setListInputs(
      Object.fromEntries(
        payload.result.settings
          .filter((setting) => setting.type === "list")
          .map((setting) => [keyOf(setting), jsonListInputs(setting.value)]),
      ),
    );
  }
  useEffect(() => {
    void load().catch((cause: unknown) => setError(messageOf(cause)));
  }, []);
  async function save(
    event: FormEvent<HTMLFormElement>,
    setting: ManagedSetting,
  ) {
    event.preventDefault();
    setMessage(undefined);
    setError(undefined);
    try {
      const response = await fetch("/api/plugins/settings/set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pluginId: setting.pluginId,
          id: setting.id,
          value: settingValue(setting, values, jsonInputs, listInputs),
        }),
      });
      if (!response.ok) throw new Error(await messageFrom(response));
      await load();
      setMessage(`${setting.name} saved.`);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }
  function updateValue(setting: ManagedSetting, value: PluginSettingValue) {
    setValues({ ...values, [keyOf(setting)]: value });
  }
  function updateListItem(
    setting: ManagedSetting,
    index: number,
    value: string,
  ) {
    const key = keyOf(setting);
    const updated = [...(listInputs[key] ?? [])];
    updated[index] = value;
    setListInputs({ ...listInputs, [key]: updated });
  }
  function addListItem(setting: ManagedSetting) {
    const key = keyOf(setting);
    setListInputs({ ...listInputs, [key]: [...(listInputs[key] ?? []), "{}"] });
  }
  function removeListItem(setting: ManagedSetting, index: number) {
    const key = keyOf(setting);
    const items = (listInputs[key] ?? []).filter(
      (_, itemIndex) => itemIndex !== index,
    );
    setListInputs({ ...listInputs, [key]: items });
  }
  return (
    <section className="conversation settings-page">
      <div className="intro">
        <div className="plugin-icon">⚙</div>
        <div>
          <h2>Plugin settings</h2>
          <p>
            Configure the preferences registered by locally installed plugins.
            Changes are stored only on this machine.
          </p>
        </div>
      </div>
      {settings.length === 0 && !error && (
        <p className="muted">No installed plugin has registered settings.</p>
      )}
      <div className="settings-list">
        {settings.map((setting) => (
          <form
            className="setting-card"
            key={keyOf(setting)}
            onSubmit={(event) => void save(event, setting)}
          >
            <div>
              <strong>{setting.name}</strong>
              <code>
                {setting.pluginId}/{setting.id}
              </code>
              {setting.description && <p>{setting.description}</p>}
            </div>
            {setting.type === "list" ? (
              <div className="setting-list-editor">
                <span>JSON items</span>
                {(listInputs[keyOf(setting)] ?? []).map((item, index) => (
                  <div
                    className="setting-list-item"
                    key={`${keyOf(setting)}:${index}`}
                  >
                    <textarea
                      aria-label={`${setting.name} item ${index + 1}`}
                      value={item}
                      onChange={(event) =>
                        updateListItem(setting, index, event.target.value)
                      }
                    />
                    <button
                      onClick={() => removeListItem(setting, index)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="add-list-item"
                  onClick={() => addListItem(setting)}
                  type="button"
                >
                  Add item
                </button>
              </div>
            ) : (
              <label>
                {setting.type === "boolean" ? (
                  <>
                    <input
                      checked={values[keyOf(setting)] === true}
                      onChange={(event) =>
                        updateValue(setting, event.target.checked)
                      }
                      type="checkbox"
                    />{" "}
                    Enabled
                  </>
                ) : setting.type === "string-list" ? (
                  <>
                    <span>One value per line</span>
                    <textarea
                      value={stringListValue(values[keyOf(setting)])}
                      onChange={(event) =>
                        updateValue(
                          setting,
                          parseStringList(event.target.value),
                        )
                      }
                    />
                  </>
                ) : setting.type === "json" ? (
                  <>
                    <span>JSON value</span>
                    <textarea
                      value={jsonInputs[keyOf(setting)] ?? ""}
                      onChange={(event) =>
                        setJsonInputs({
                          ...jsonInputs,
                          [keyOf(setting)]: event.target.value,
                        })
                      }
                    />
                  </>
                ) : (
                  <>
                    <span>Value</span>
                    <input
                      type={setting.type === "number" ? "number" : "text"}
                      value={String(values[keyOf(setting)] ?? "")}
                      onChange={(event) =>
                        updateValue(
                          setting,
                          setting.type === "number"
                            ? Number(event.target.value)
                            : event.target.value,
                        )
                      }
                    />
                  </>
                )}
              </label>
            )}
            <button type="submit">Save</button>
          </form>
        ))}
      </div>
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}
function keyOf(setting: ManagedSetting): string {
  return `${setting.pluginId}:${setting.id}`;
}
function stringListValue(value: PluginSettingValue | undefined): string {
  return Array.isArray(value) ? value.join("\n") : "";
}
function parseStringList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function jsonListInputs(value: PluginSettingValue): string[] {
  return Array.isArray(value)
    ? value.map((item) => JSON.stringify(item, null, 2))
    : [];
}
function settingValue(
  setting: ManagedSetting,
  values: Record<string, PluginSettingValue>,
  jsonInputs: Record<string, string>,
  listInputs: Record<string, string[]>,
): PluginSettingValue {
  if (setting.type === "json")
    return parseJsonSetting(setting.name, jsonInputs[keyOf(setting)] ?? "");
  if (setting.type === "list")
    return (listInputs[keyOf(setting)] ?? []).map((item) =>
      parseJsonSetting(setting.name, item),
    );
  return values[keyOf(setting)];
}
function parseJsonSetting(name: string, input: string): JsonSettingValue {
  try {
    return JSON.parse(input) as JsonSettingValue;
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
}
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error.";
}
async function messageFrom(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: string };
  return body.error ?? "Request failed.";
}
