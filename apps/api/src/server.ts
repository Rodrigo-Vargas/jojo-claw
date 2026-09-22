import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import {
  type DatabaseOperations,
  type LlmProvider,
  type PlatformPlugin,
  type PluginRoute,
  type PluginRouteRedirect,
} from "@jojo-claw/core";
import { createDatabasePlugin } from "@jojo-claw/database-plugin";
import { OllamaProvider } from "@jojo-claw/ollama";
import { createSecretsPlugin, SecretRegistry } from "@jojo-claw/secrets-plugin";
import {
  createSettingsPlugin,
  SettingsRegistry,
} from "@jojo-claw/settings-plugin";
import { createEmailAssistantPlugin } from "@jojo-claw/email-assistant";
import { textPlugin } from "@jojo-claw/text-plugin";
import { toolCallingPlugin } from "@jojo-claw/tool-calling-plugin";
import { PromptQueue } from "./PromptQueue.js";

export interface JojoClawOptions {
  provider?: LlmProvider;
  plugins?: PlatformPlugin[];
  secretFilePath?: string;
  settingsFilePath?: string;
  databasePath?: string;
}

/** Creates the HTTP boundary and mounts the locally installed plugin packages. */
export function createJojoClawServer(options: JojoClawOptions = {}) {
  const provider = options.provider ?? new OllamaProvider();
  const secrets = new SecretRegistry(
    options.secretFilePath ?? resolve(process.cwd(), ".env"),
  );
  const settings = new SettingsRegistry(
    options.settingsFilePath ??
      resolve(process.cwd(), ".jojo-claw", "settings.json"),
  );
  const database = createDatabasePlugin({ storagePath: options.databasePath });
  const promptQueue = new PromptQueue();
  const plugins = [
    database.plugin,
    createSecretsPlugin(secrets),
    createSettingsPlugin(settings),
    ...(options.plugins ?? [textPlugin, toolCallingPlugin, createEmailAssistantPlugin()]),
  ];
  const routes = mountPlugins(plugins, {
    provider,
    secrets,
    settings,
    database: database.operations,
    promptQueue,
  });
  return createServer(async (request, response) => {
    setCors(response);
    if (request.method === "OPTIONS") return response.end();
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    try {
      if (request.method === "GET" && url.pathname === "/health")
        return sendJson(response, 200, { status: "ok" });
      if (request.method === "GET" && url.pathname === "/api/plugins")
        return sendJson(response, 200, {
          plugins: plugins.map((plugin) => plugin.manifest),
        });
      if (request.method === "GET" && url.pathname === "/api/prompt-queue")
        return sendJson(response, 200, { items: promptQueue.snapshot() });
      const route = routes.get(`${request.method ?? "GET"} ${url.pathname}`);
      if (route) {
        const result = await route.handle({
          method: request.method === "GET" ? "GET" : "POST",
          query: Object.fromEntries(url.searchParams),
          body: request.method === "POST" ? await readJson(request) : undefined,
        });
        if (isPluginRouteRedirect(result)) {
          response.writeHead(result.status ?? 302, {
            location: result.location,
          });
          return response.end();
        }
        return sendJson(response, 200, { result });
      }
      return sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected server error.";
      return sendJson(
        response,
        message.includes("required") || message.includes("must be strings")
          ? 400
          : 502,
        { error: message },
      );
    }
  });
}

interface PluginServices {
  provider: LlmProvider;
  secrets: SecretRegistry;
  settings: SettingsRegistry;
  database: DatabaseOperations;
  promptQueue: PromptQueue;
}

function mountPlugins(
  plugins: PlatformPlugin[],
  services: PluginServices,
): Map<string, PluginRoute> {
  const routes = new Map<string, PluginRoute>();
  for (const plugin of plugins)
    plugin.register({
      generateText: (input) =>
        services.promptQueue.enqueue(
          plugin.manifest.name,
          input.prompt,
          () => services.provider.generate(input),
        ),
      generateWithTools: (input) => {
        if (!services.provider.generateWithTools)
          throw new Error("The configured LLM provider does not support tool calling.");
        return services.promptQueue.enqueue(
          plugin.manifest.name,
          promptFromMessages(input.messages),
          () => services.provider.generateWithTools!(input),
        );
      },
      database: services.database,
      registerRoute: (route) => {
        if (!route.path.startsWith("/"))
          throw new Error(
            `Plugin route for ${plugin.manifest.id} must start with '/'.`,
          );
        const key = `${route.method} /api/plugins/${plugin.manifest.id}${route.path}`;
        if (routes.has(key)) throw new Error(`Duplicate plugin route: ${key}`);
        routes.set(key, route);
      },
      registerSecret: (secret) =>
        services.secrets.register(plugin.manifest.id, secret),
      getSecret: (id) => services.secrets.get(plugin.manifest.id, id),
      registerSetting: (setting) =>
        services.settings.register(plugin.manifest.id, setting),
      getSetting: (id) => services.settings.get(plugin.manifest.id, id),
      setSetting: (id, value) =>
        services.settings.set(plugin.manifest.id, id, value),
    });
  return routes;
}

function promptFromMessages(messages: { role: string; content: string }[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return message.content;
  }
  return "Tool-assisted generation";
}

function isPluginRouteRedirect(value: unknown): value is PluginRouteRedirect {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as PluginRouteRedirect).type === "redirect" &&
    typeof (value as PluginRouteRedirect).location === "string"
  );
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString("utf8");
  return (body ? JSON.parse(body) : undefined) as T;
}
function setCors(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}
function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}
