import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  PlatformPlugin,
  PluginStorage,
  StorageOperations,
} from "@jojo-claw/core";
import { databasePluginManifest } from "./manifest.js";

export interface DatabasePluginOptions {
  storagePath?: string;
}

export interface ConfiguredDatabasePlugin {
  plugin: PlatformPlugin;
  storage: StorageOperations;
}

interface StorageRow {
  key: string;
  value: string;
}

function initializeSchema(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (plugin_id, key)
    ) STRICT;
  `);
}

function storageFor(connection: DatabaseSync, pluginId: string): PluginStorage {
  return {
    get: (key) => getRecord(connection, pluginId, key),
    set: (key, value) => setRecord(connection, pluginId, key, value),
    delete: (key) => deleteRecord(connection, pluginId, key),
    entries: () => listRecords(connection, pluginId),
  };
}

function getRecord<T>(
  connection: DatabaseSync, pluginId: string, key: string,
): T | undefined {
  const row = connection
    .prepare("SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?")
    .get(pluginId, key) as Pick<StorageRow, "value"> | undefined;
  return row === undefined ? undefined : JSON.parse(row.value) as T;
}

function setRecord<T>(
  connection: DatabaseSync, pluginId: string, key: string, value: T,
): void {
  connection.prepare(`INSERT INTO plugin_storage (plugin_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value`)
    .run(pluginId, key, JSON.stringify(value));
}

function deleteRecord(connection: DatabaseSync, pluginId: string, key: string): void {
  connection.prepare("DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?")
    .run(pluginId, key);
}

function listRecords<T>(
  connection: DatabaseSync, pluginId: string,
): Array<{ key: string; value: T }> {
  const rows = connection
    .prepare("SELECT key, value FROM plugin_storage WHERE plugin_id = ? ORDER BY key")
    .all(pluginId) as unknown as StorageRow[];
  return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) as T }));
}

/** Configures SQLite storage for records owned by installed plugins.
 * Example: `createDatabasePlugin({ storagePath: :memory: })`.
 */
export function createDatabasePlugin(
  options: DatabasePluginOptions = {},
): ConfiguredDatabasePlugin {
  const storagePath = options.storagePath ?? resolve(process.cwd(), ".jojo-claw", "database.db");
  if (storagePath !== ":memory:") mkdirSync(dirname(storagePath), { recursive: true });
  const connection = new DatabaseSync(storagePath);
  initializeSchema(connection);
  return {
    plugin: { manifest: databasePluginManifest, register() {} },
    storage: { forPlugin: (pluginId) => storageFor(connection, pluginId) },
  };
}
