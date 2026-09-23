import type { PlatformPlugin } from "@jojo-claw/core";
import { promptsPluginManifest } from "./manifest.js";
import { PromptRegistry } from "./registry.js";

export { PromptRegistry, type ManagedPrompt } from "./registry.js";

/** Creates the built-in plugin that presents and edits registered prompts. */
export function createPromptsPlugin(prompts: PromptRegistry): PlatformPlugin {
  return {
    manifest: promptsPluginManifest,
    register(context) {
      context.registerRoute({
        method: "POST", path: "/list",
        async handle() { return { prompts: prompts.list() }; },
      });
      context.registerRoute({ method: "POST", path: "/set", async handle({ body }) {
        if (!isSetPromptInput(body))
          throw new Error("pluginId, id, and content must be strings.");
        prompts.set(body.pluginId, body.id, body.content);
        return { content: prompts.get(body.pluginId, body.id) };
      } });
    },
  };
}

function isSetPromptInput(
  value: unknown,
): value is { pluginId: string; id: string; content: string } {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return typeof input.pluginId === "string" && typeof input.id === "string" &&
    typeof input.content === "string";
}
