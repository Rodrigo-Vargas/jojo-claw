import type { PluginSettingType, PluginSettingValue } from "@jojo-claw/core";

export interface ManagedSetting {
  pluginId: string;
  id: string;
  name: string;
  description?: string;
  type: PluginSettingType;
  defaultValue: PluginSettingValue;
  value: PluginSettingValue;
  optionsEndpoint?: string;
}

interface SettingEditorProps {
  setting: ManagedSetting;
  value: PluginSettingValue | undefined;
  jsonInput: string;
  listInput: string[];
  selectOptions: string[];
  onValueChange(value: PluginSettingValue): void;
  onJsonChange(value: string): void;
  onListChange(items: string[]): void;
}

/** Renders the standard control for a registered plugin setting. */
export function SettingEditor({
  setting, value, jsonInput, listInput, selectOptions, onValueChange, onJsonChange,
  onListChange,
}: SettingEditorProps) {
  if (setting.type === "list") {
    return <JsonListEditor items={listInput} settingName={setting.name} onChange={onListChange} />;
  }
  if (setting.type === "boolean") return <BooleanEditor value={value} onChange={onValueChange} />;
  if (setting.type === "string-list") {
    return <StringListEditor value={value} onChange={onValueChange} />;
  }
  if (setting.type === "json") return <JsonEditor value={jsonInput} onChange={onJsonChange} />;
  if (setting.optionsEndpoint) {
    return <SelectEditor options={selectOptions} value={value} onChange={onValueChange} />;
  }
  return <TextEditor setting={setting} value={value} onChange={onValueChange} />;
}

function JsonListEditor({ items, settingName, onChange }: {
  items: string[];
  settingName: string;
  onChange(items: string[]): void;
}) {
  function replaceItem(index: number, value: string) {
    const nextItems = [...items];
    nextItems[index] = value;
    onChange(nextItems);
  }
  function removeItem(index: number) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }
  return <div className="setting-list-editor">
    <span>JSON items</span>
    {items.map((item, index) => <div className="setting-list-item" key={`${settingName}:${index}`}>
      <textarea aria-label={`${settingName} item ${index + 1}`} value={item}
        onChange={(event) => replaceItem(index, event.target.value)} />
      <button onClick={() => removeItem(index)} type="button">Remove</button>
    </div>)}
    <button className="add-list-item" onClick={() => onChange([...items, "{}"])} type="button">
      Add item
    </button>
  </div>;
}

function BooleanEditor({ value, onChange }: {
  value: PluginSettingValue | undefined;
  onChange(value: boolean): void;
}) {
  return <label>
    <input checked={value === true} type="checkbox"
      onChange={(event) => onChange(event.target.checked)} />{" "}
    Enabled
  </label>;
}

function StringListEditor({ value, onChange }: {
  value: PluginSettingValue | undefined;
  onChange(value: string[]): void;
}) {
  return <label>
    <span>One value per line</span>
    <textarea value={stringListValue(value)}
      onChange={(event) => onChange(parseStringList(event.target.value))} />
  </label>;
}

function JsonEditor({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <label>
    <span>JSON value</span>
    <textarea value={value} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

function SelectEditor({ options, value, onChange }: {
  options: string[];
  value: PluginSettingValue | undefined;
  onChange(value: string): void;
}) {
  return <label>
    <span>Installed model</span>
    <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select a model</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </label>;
}

function TextEditor({ setting, value, onChange }: {
  setting: ManagedSetting;
  value: PluginSettingValue | undefined;
  onChange(value: string | number): void;
}) {
  return <label>
    <span>Value</span>
    <input type={setting.type === "number" ? "number" : "text"} value={String(value ?? "")}
      onChange={(event) => onChange(
        setting.type === "number" ? Number(event.target.value) : event.target.value,
      )} />
  </label>;
}

function stringListValue(value: PluginSettingValue | undefined): string {
  return Array.isArray(value) ? value.join("\n") : "";
}

function parseStringList(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}
