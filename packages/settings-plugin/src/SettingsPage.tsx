import { type FormEvent, useEffect, useState } from "react";
import type {
  JsonSettingValue,
  PluginSettingValue,
} from "@jojo-claw/core";
import {
  CategoryActionList,
  emailCategoryNames,
  isCategoryActionSetting,
  type GmailLabel,
} from "./CategoryActionList.js";
import { SettingEditor, type ManagedSetting } from "./SettingEditor.js";

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
    void loadSelectOptions(payload.result.settings, setSelectOptions);
  }
  useEffect(() => {
    void load().catch((cause: unknown) => setError(messageOf(cause)));
    void loadGmailLabels(setGmailLabels);
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
      <SettingsList settings={settings} values={values} jsonInputs={jsonInputs}
        listInputs={listInputs} gmailLabels={gmailLabels} selectOptions={selectOptions}
        onJsonInputsChange={setJsonInputs} onListInputsChange={setListInputs}
        onSave={save} onValueChange={updateValue} />
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}

function SettingsList({
  settings, values, jsonInputs, listInputs, gmailLabels, selectOptions,
  onJsonInputsChange, onListInputsChange, onSave, onValueChange,
}: {
  settings: ManagedSetting[];
  values: Record<string, PluginSettingValue>;
  jsonInputs: Record<string, string>;
  listInputs: Record<string, string[]>;
  gmailLabels: GmailLabel[];
  selectOptions: Record<string, string[]>;
  onJsonInputsChange(inputs: Record<string, string>): void;
  onListInputsChange(inputs: Record<string, string[]>): void;
  onSave(event: FormEvent<HTMLFormElement>, setting: ManagedSetting): Promise<void>;
  onValueChange(setting: ManagedSetting, value: PluginSettingValue): void;
}) {
  return <div className="settings-list">
    {settings.map((setting) => <form className="setting-card" key={keyOf(setting)}
      onSubmit={(event) => void onSave(event, setting)}>
      <div>
        <strong>{setting.name}</strong>
        <code>{setting.pluginId}/{setting.id}</code>
        {setting.description && <p>{setting.description}</p>}
      </div>
      {isCategoryActionSetting(setting.pluginId, setting.id) ? (
        <CategoryActionList categories={emailCategoryNames(settings)} labels={gmailLabels}
          settingName={setting.name} values={listInputs[keyOf(setting)] ?? []}
          onChange={(items) => onListInputsChange({ ...listInputs, [keyOf(setting)]: items })} />
      ) : (
        <SettingEditor jsonInput={jsonInputs[keyOf(setting)] ?? ""}
          listInput={listInputs[keyOf(setting)] ?? []}
          selectOptions={selectOptions[keyOf(setting)] ?? []} setting={setting}
          value={values[keyOf(setting)]}
          onJsonChange={(value) => onJsonInputsChange({ ...jsonInputs, [keyOf(setting)]: value })}
          onListChange={(items) => onListInputsChange({ ...listInputs, [keyOf(setting)]: items })}
          onValueChange={(value) => onValueChange(setting, value)} />
      )}
      <button type="submit">Save</button>
    </form>)}
  </div>;
}

async function loadGmailLabels(onLabels: (labels: GmailLabel[]) => void) {
  try {
    const response = await fetch("/api/plugins/email-assistant/labels");
    const payload = (await response.json()) as { result?: GmailLabel[] };
    if (response.ok && payload.result) onLabels(payload.result);
  } catch {
    /* Email actions can still be configured after Gmail is connected. */
  }
}

async function loadSelectOptions(
  loadedSettings: ManagedSetting[],
  onOptions: (options: Record<string, string[]>) => void,
) {
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
  onOptions(Object.fromEntries(choices));
}
function keyOf(setting: ManagedSetting): string {
  return `${setting.pluginId}:${setting.id}`;
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
