import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PromptDefinition } from "@jojo-claw/core";

export interface ManagedPrompt extends PromptDefinition {
  pluginId: string;
  content: string;
}

type RegisteredPrompt = ManagedPrompt;

/** Owns declared prompts and persists user edits as one file per prompt.
 * Example: `registry.get("email-assistant", "email-summary")`.
 */
export class PromptRegistry {
  private readonly definitions = new Map<string, RegisteredPrompt>();

  constructor(private readonly storageDirectory: string) {}

  define(pluginId: string, definition: PromptDefinition): void {
    const registered = { ...definition, pluginId };
    if (!validDefinition(registered))
      throw new Error(
        `Invalid prompt definition for ${registered.pluginId}/${registered.id}; ` +
          "id, name, and defaultContent are required.",
      );
    const key = keyOf(registered.pluginId, registered.id);
    if (this.definitions.has(key)) throw new Error(`Duplicate plugin prompt: ${key}`);
    this.definitions.set(key, { ...registered, content: this.readContent(registered) });
  }

  get(pluginId: string, id: string): string {
    const prompt = this.definitions.get(keyOf(pluginId, id));
    if (!prompt) throw new Error(`Unknown plugin prompt: ${pluginId}/${id}`);
    return prompt.content;
  }

  list(): ManagedPrompt[] {
    return [...this.definitions.values()].map((prompt) => ({ ...prompt }));
  }

  set(pluginId: string, id: string, content: string): void {
    const prompt = this.definitions.get(keyOf(pluginId, id));
    if (!prompt || typeof content !== "string")
      throw new Error(`Prompt ${pluginId}/${id} requires string content.`);
    prompt.content = content;
    mkdirSync(join(this.storageDirectory, pluginId), { recursive: true });
    writeFileSync(this.filePath(pluginId, id), content, "utf8");
  }

  private readContent(definition: PromptDefinition & { pluginId: string }): string {
    const path = this.filePath(definition.pluginId, definition.id);
    return existsSync(path) ? readFileSync(path, "utf8") : definition.defaultContent;
  }

  private filePath(pluginId: string, id: string): string {
    return join(this.storageDirectory, pluginId, `${id}.txt`);
  }
}

function validDefinition(value: PromptDefinition & { pluginId: string }): boolean {
  return Boolean(value.pluginId && value.id && value.name && value.defaultContent) &&
    (value.kind === "prompt" || value.kind === "system");
}

function keyOf(pluginId: string, id: string): string {
  return `${pluginId}:${id}`;
}
