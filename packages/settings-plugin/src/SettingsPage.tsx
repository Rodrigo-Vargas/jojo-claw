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
  optionsEndpoint?: string;
}
interface GmailLabel { id: string; name: string }

export default function SettingsPage() {
  const [settings, setSettings] = useState<ManagedSetting[]>([]);
  const [values, setValues] = useState<Record<string, PluginSettingValue>>({});
  const [jsonInputs, setJsonInputs] = useState<Record<string, string>>({});
  const [listInputs, setListInputs] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [gmailLabels, setGmailLabels] = useState<GmailLabel[]>([]);
  const [selectOptions, setSelectOptions] = useState<Record<string, string[]>>({});
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
    void loadSelectOptions(payload.result.settings);
  }
  useEffect(() => {
    void load().catch((cause: unknown) => setError(messageOf(cause)));
    void loadGmailLabels();
  }, []);
  async function loadGmailLabels() {
    try {
      const response = await fetch("/api/plugins/email-assistant/labels");
      const payload = (await response.json()) as { result?: GmailLabel[] };
      if (response.ok && payload.result) setGmailLabels(payload.result);
    } catch {
      /* Email actions can still be configured after Gmail is connected. */
    }
  }
  async function loadSelectOptions(loadedSettings: ManagedSetting[]) {
    const selectable = loadedSettings.filter((setting) => setting.optionsEndpoint);
    const choices = await Promise.all(selectable.map(async (setting) => {
      const response = await fetch(setting.optionsEndpoint ?? "");
      if (!response.ok) return [keyOf(setting), []] as const;
      const payload = (await response.json()) as { options?: unknown };
      const options = Array.isArray(payload.options)
        ? payload.options.filter((option): option is string => typeof option === "string")
        : [];
      return [keyOf(setting), options] as const;
    }));
    setSelectOptions(Object.fromEntries(choices));
  }
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
            {isCategoryActionSetting(setting) ? (
              <CategoryActionList
                categories={emailCategoryNames(settings)}
                labels={gmailLabels}
                setting={setting}
                values={listInputs[keyOf(setting)] ?? []}
                onChange={(items) =>
                  setListInputs({ ...listInputs, [keyOf(setting)]: items })
                }
              />
            ) : setting.type === "list" ? (
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
                ) : setting.optionsEndpoint ? (
                  <>
                    <span>Installed model</span>
                    <select
                      value={String(values[keyOf(setting)] ?? "")}
                      onChange={(event) => updateValue(setting, event.target.value)}
                    >
                      <option value="">Select a model</option>
                      {(selectOptions[keyOf(setting)] ?? []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
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
function isCategoryActionSetting(setting: ManagedSetting): boolean {
  return setting.pluginId === "email-assistant" && setting.id === "category-actions";
}
function emailCategoryNames(settings: ManagedSetting[]): string[] {
  const setting = settings.find(
    (item) => item.pluginId === "email-assistant" && item.id === "categories",
  );
  if (!setting || !Array.isArray(setting.value)) return [];
  return setting.value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (!item || typeof item !== "object") return [];
    const name = (item as { name?: unknown }).name;
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  });
}
function CategoryActionList({
  categories, labels, setting, values, onChange,
}: {
  categories: string[]; labels: GmailLabel[]; setting: ManagedSetting;
  values: string[]; onChange(items: string[]): void;
}) {
  const actions = categoryActionMap(values);
  function setActions(category: string, selectedActions: string[]) {
    const next = new Map(actions);
    if (selectedActions.length) next.set(category, selectedActions);
    else next.delete(category);
    onChange([...next].map(([name, value]) =>
      JSON.stringify({ category: name, actions: value }),
    ));
  }
  return <div className="setting-list-editor">
    <span>Suggested actions by category</span>
    {categories.map((category) => <label key={category}>
      <span>{category}</span>
      <select multiple aria-label={`${setting.name} ${category}`}
        value={actions.get(category) ?? []}
        onChange={(event) => setActions(
          category,
          [...event.currentTarget.selectedOptions].map((option) => option.value),
        )}>
        <option value="mark-read">Mark as read</option>
        <option value="star">Star</option>
        <option value="trash">Move to trash</option>
        {labels.map((label) => (
          <option key={label.id} value={`archive:${label.name}`}>
            Archive in {label.name}
          </option>
        ))}
      </select>
    </label>)}
    {categories.length === 0 && <span>Add email categories before mapping actions.</span>}
  </div>;
}
function categoryActionMap(values: string[]): Map<string, string[]> {
  return new Map(values.flatMap((value) => {
    try {
      const entry = JSON.parse(value) as {
        category?: unknown; action?: unknown; actions?: unknown;
      };
      const actions = Array.isArray(entry.actions) ? entry.actions : [entry.action];
      return typeof entry.category === "string" &&
        actions.every((action) => typeof action === "string")
        ? [[entry.category, actions] as [string, string[]]] : [];
    } catch { return []; }
  }));
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
