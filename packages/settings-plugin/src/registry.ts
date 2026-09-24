import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  JsonSettingValue,
  PluginSettingDefinition,
  PluginSettingValue,
} from "@jojo-claw/core";

export interface ManagedSetting extends PluginSettingDefinition {
  pluginId: string;
  value: PluginSettingValue;
}

/** Owns setting declarations and their local, JSON-backed values. */
export class SettingsRegistry {
  private readonly definitions = new Map<string, ManagedSetting>();
  private readonly values: Record<string, PluginSettingValue>;

  constructor(private readonly storagePath: string) {
    this.values = loadValues(storagePath);
  }

  register(pluginId: string, definition: PluginSettingDefinition): void {
    const validDefault = isSettingValue(definition, definition.defaultValue);
    if (!definition.id || !definition.name || !validDefault) {
      throw new Error(
        "Plugin settings require an id, name, and matching default value.",
      );
    }
    const key = keyOf(pluginId, definition.id);
    if (this.definitions.has(key))
      throw new Error(`Duplicate plugin setting: ${pluginId}/${definition.id}`);
    this.migrateLegacyValue(key, definition);
    this.definitions.set(key, {
      ...definition,
      pluginId,
      value: this.valueFor(pluginId, definition),
    });
  }

  list(): ManagedSetting[] {
    return [...this.definitions.values()].map((setting) => ({
      ...setting,
      value: this.valueFor(setting.pluginId, setting),
    }));
  }
  get(pluginId: string, id: string): PluginSettingValue {
    const setting = this.definitions.get(keyOf(pluginId, id));
    if (!setting) throw new Error(`Unknown plugin setting: ${pluginId}/${id}`);
    return this.valueFor(pluginId, setting);
  }
  set(pluginId: string, id: string, value: unknown): void {
    const setting = this.definitions.get(keyOf(pluginId, id));
    if (!setting || !isSettingValue(setting, value))
      throw new Error("Invalid plugin setting value.");
    this.values[keyOf(pluginId, id)] = value;
    this.saveValues();
  }
  private migrateLegacyValue(key: string, definition: PluginSettingDefinition): void {
    const value = this.values[key];
    if (isSettingValue(definition, value) || !definition.migrateLegacyValue) return;
    const migrated = definition.migrateLegacyValue(value);
    if (!isSettingValue(definition, migrated)) return;
    this.values[key] = migrated;
    this.saveValues();
  }
  private saveValues(): void {
    mkdirSync(dirname(this.storagePath), { recursive: true });
    writeFileSync(
      this.storagePath,
      `${JSON.stringify(this.values, null, 2)}\n`,
      "utf8",
    );
  }
  private valueFor(
    pluginId: string,
    definition: PluginSettingDefinition,
  ): PluginSettingValue {
    const value = this.values[keyOf(pluginId, definition.id)];
    return isSettingValue(definition, value) ? value : definition.defaultValue;
  }
}

function keyOf(pluginId: string, id: string): string {
  return `${pluginId}:${id}`;
}
function loadValues(path: string): Record<string, PluginSettingValue> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, PluginSettingValue] => isValue(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}
function isSettingValue(
  definition: PluginSettingDefinition,
  value: unknown,
): value is PluginSettingValue {
  return (
    (definition.type === "string" && typeof value === "string") ||
    (definition.type === "number" &&
      typeof value === "number" &&
      Number.isFinite(value)) ||
    (definition.type === "boolean" && typeof value === "boolean") ||
    (definition.type === "string-list" && isStringList(value)) ||
    (definition.type === "json" && isJsonSettingValue(value)) ||
    (definition.type === "list" && isJsonSettingList(value))
  );
}
function isValue(value: unknown): value is PluginSettingValue {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    isStringList(value) ||
    isJsonSettingValue(value)
  );
}
function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
function isJsonSettingList(value: unknown): value is JsonSettingValue[] {
  return Array.isArray(value) && value.every(isJsonSettingValue);
}
function isJsonSettingValue(value: unknown): value is PluginSettingValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonSettingValue);
  return (
    typeof value === "object" && Object.values(value).every(isJsonSettingValue)
  );
}
