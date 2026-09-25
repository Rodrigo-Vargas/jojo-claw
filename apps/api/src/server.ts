import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import {
  type StorageOperations,
  type LlmProvider,
  type PlatformPlugin,
  type PromptDefinition,
  type PromptOperations,
  type JsonSettingValue,
  type PluginRoute,
  type PluginRouteRedirect,
  type ToolCall,
} from "@jojo-claw/core";
import { createDatabasePlugin } from "@jojo-claw/database-plugin";
import {
  OllamaProvider,
  type OllamaProviderOptions,
} from "@jojo-claw/ollama";
import { createSecretsPlugin, SecretRegistry } from "@jojo-claw/secrets-plugin";
import {
  createSettingsPlugin,
  SettingsRegistry,
} from "@jojo-claw/settings-plugin";
import { createEmailAssistantPlugin } from "@jojo-claw/email-assistant";
import { createPromptsPlugin, PromptRegistry } from "@jojo-claw/prompt-plugin";
import { textPlugin } from "@jojo-claw/text-plugin";
import { toolCallingPlugin } from "@jojo-claw/tool-calling-plugin";
import { PromptQueue, type PromptConversation } from "./PromptQueue.js";

export interface JojoClawOptions {
  provider?: LlmProvider;
  plugins?: PlatformPlugin[];
  secretFilePath?: string;
  settingsFilePath?: string;
  databasePath?: string;
  promptsDirectory?: string;
  ollama?: Omit<OllamaProviderOptions, "model">;
}

/** Creates the HTTP boundary and mounts the locally installed plugin packages. */
export function createJojoClawServer(options: JojoClawOptions = {}) {
  const secrets = new SecretRegistry(
    options.secretFilePath ?? resolve(process.cwd(), ".env"),
  );
  const settings = new SettingsRegistry(
    options.settingsFilePath ??
      resolve(process.cwd(), ".jojo-claw", "settings.json"),
  );
  const provider =
    options.provider ?? createConfiguredOllamaProvider(settings, options.ollama);
  if (provider instanceof OllamaProvider) registerOllamaModelSetting(settings);
  const database = createDatabasePlugin({ storagePath: options.databasePath });
  const prompts = new PromptRegistry(
    options.promptsDirectory ?? resolve(process.cwd(), ".jojo-claw", "prompts"),
  );
  const promptQueue = new PromptQueue(database.storage.forPlugin("prompt-queue"));
  const plugins = [
    database.plugin,
    createSecretsPlugin(secrets),
    createSettingsPlugin(settings),
    createPromptsPlugin(prompts),
    ...(options.plugins ?? [textPlugin, toolCallingPlugin, createEmailAssistantPlugin()]),
  ];
  const routes = mountPlugins(plugins, {
    provider,
    secrets,
    settings,
    storage: database.storage,
    promptQueue,
    prompts,
  });
  const server = createServer(async (request, response) => {
    setCors(response);
    if (request.method === "OPTIONS") return response.end();
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    try {
      const platformResponse = await platformResponseFor(
        request.method,
        url.pathname,
        { plugins, promptQueue, prompts, provider },
      );
      if (platformResponse)
        return sendJson(response, platformResponse.status, platformResponse.body);
      const conversationId = conversationIdFromPath(url.pathname);
      const retryConversationId = retryConversationIdFromPath(url.pathname);
      if (request.method === "POST" && retryConversationId !== undefined)
        return retryConversation(request, response, {
          conversationId: retryConversationId, promptQueue, provider,
        });
      if (request.method === "POST" && conversationId !== undefined)
        return sendConversationMessage(request, response, {
          conversationId, promptQueue, provider,
        });
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
  server.on("close", () => database.close());
  return server;
}

async function platformResponseFor(
  method: string | undefined,
  pathname: string,
  services: PlatformApiServices,
): Promise<{ status: number; body: unknown } | undefined> {
  if (method !== "GET") return undefined;
  if (pathname === "/health") return { status: 200, body: { status: "ok" } };
  if (pathname === "/api/plugins")
    return {
      status: 200,
      body: { plugins: services.plugins.map((plugin) => plugin.manifest) },
    };
  if (pathname === "/api/prompt-queue")
    return { status: 200, body: { items: services.promptQueue.snapshot() } };
  if (pathname === "/api/conversations")
    return { status: 200, body: { conversations: services.promptQueue.conversations() } };
  const conversationId = conversationIdFromPath(pathname);
  if (conversationId !== undefined) {
    const messages = services.promptQueue.conversationHistory(conversationId);
    if (!messages) return { status: 404, body: { error: "Conversation not found." } };
    return { status: 200, body: { conversation: messages.at(-1), messages } };
  }
  if (pathname !== "/api/ollama/models") return undefined;
  if (!(services.provider instanceof OllamaProvider))
    return { status: 404, body: { error: "Ollama is not configured." } };
  return {
    status: 200,
    body: {
      options: (await services.provider.listModels()).map((model) => model.name),
    },
  };
}

interface PlatformApiServices {
  plugins: PlatformPlugin[];
  promptQueue: PromptQueue;
  prompts: PromptOperations;
  provider: LlmProvider;
}

function createConfiguredOllamaProvider(
  settings: SettingsRegistry,
  options: Omit<OllamaProviderOptions, "model"> | undefined,
): OllamaProvider {
  return new OllamaProvider({
    ...options,
    model: () => settings.get("ollama", "default-model") as string,
  });
}

function registerOllamaModelSetting(settings: SettingsRegistry): void {
  settings.register("ollama", {
    id: "default-model",
    name: "Default Ollama model",
    description:
      "Used for requests that do not specify a model. Installed models come from Ollama.",
    type: "string",
    defaultValue: process.env.OLLAMA_MODEL ?? "",
    optionsEndpoint: "/api/ollama/models",
  });
}

interface PluginServices {
  provider: LlmProvider;
  secrets: SecretRegistry;
  settings: SettingsRegistry;
  storage: StorageOperations;
  promptQueue: PromptQueue;
  prompts: PromptOperations;
}

function mountPlugins(
  plugins: PlatformPlugin[],
  services: PluginServices,
): Map<string, PluginRoute> {
  const routes = new Map<string, PluginRoute>();
  for (const plugin of plugins)
    plugin.register({
      generateText: (input) =>
        services.promptQueue.enqueue({
          pluginName: plugin.manifest.name, prompt: input.prompt,
          work: () => services.provider.generate(input),
          responseFor: (result) => ({ text: result.text, model: result.model }),
          options: { system: input.system, model: input.model },
        }),
      generateWithTools: (input) => {
        if (!services.provider.generateWithTools)
          throw new Error("The configured LLM provider does not support tool calling.");
        let conversationId = input.retryConversationId;
        const work = async () => ({
          ...(await services.provider.generateWithTools!({
            messages: input.messages, tools: input.tools, model: input.model,
          })), conversationId,
        });
        type ToolGeneration = Awaited<ReturnType<NonNullable<LlmProvider["generateWithTools"]>>>;
        const responseFor = (result: ToolGeneration) => ({
          text: result.text, model: result.model,
          toolCalls: result.toolCalls.map(toolCallForConversation),
        });
        if (conversationId !== undefined)
          return services.promptQueue.replay(conversationId, work, responseFor);
        return services.promptQueue.enqueue({
          pluginName: plugin.manifest.name, prompt: promptFromMessages(input.messages),
          work, responseFor,
          options: { system: systemFromMessages(input.messages), model: input.model },
          onCreated: (id) => { conversationId = id; },
        });
      },
      recordToolCallResult: (conversationId, call) =>
        services.promptQueue.recordToolCallResult(conversationId, call),
      storage: services.storage.forPlugin(plugin.manifest.id),
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
      definePrompt: (definition: PromptDefinition) =>
        services.prompts.define(plugin.manifest.id, definition),
      getPrompt: (id) => services.prompts.get(plugin.manifest.id, id),
      setPrompt: (pluginId, id, content) =>
        services.prompts.set(pluginId, id, content),
    });
  return routes;
}

function toolCallForConversation(call: ToolCall): {
  id: string; name: string; arguments: Record<string, JsonSettingValue>;
} {
  return { id: call.id, name: call.name, arguments: call.arguments };
}

function promptFromMessages(messages: { role: string; content: string }[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return message.content;
  }
  return "Tool-assisted generation";
}

function systemFromMessages(messages: { role: string; content: string }[]): string | undefined {
  return messages.find((message) => message.role === "system")?.content;
}

function conversationIdFromPath(pathname: string): number | undefined {
  const match = /^\/api\/conversations\/(\d+)$/.exec(pathname);
  return match ? Number(match[1]) : undefined;
}

function retryConversationIdFromPath(pathname: string): number | undefined {
  const match = /^\/api\/conversations\/(\d+)\/retry$/.exec(pathname);
  return match ? Number(match[1]) : undefined;
}

function isConversationMessageInput(value: unknown): value is { message: string } {
  return typeof value === "object" && value !== null
    && typeof (value as { message?: unknown }).message === "string"
    && (value as { message: string }).message.trim().length > 0;
}

function conversationPrompt(history: PromptConversation[], message: string): string {
  const turns = history.flatMap((turn) => [
    `User: ${turn.prompt}`,
    ...(turn.response ? [`Assistant: ${turn.response.text}`] : []),
  ]);
  return [...turns, `User: ${message}`, "Assistant:"].join("\n\n");
}

async function sendConversationMessage(
  request: IncomingMessage, response: ServerResponse, services: ConversationMessageServices,
): Promise<void> {
  const input = await readJson<unknown>(request);
  if (!isConversationMessageInput(input)) throw new Error("message must be a non-empty string.");
  const parent = services.promptQueue.conversation(services.conversationId);
  if (!parent) return sendJson(response, 404, { error: "Conversation not found." });
  if (parent.status !== "succeeded")
    return sendJson(response, 409, {
      error: "Only completed conversations can receive a new message.",
    });
  const history = services.promptQueue.conversationHistory(services.conversationId) ?? [];
  const result = await services.promptQueue.enqueue({
    pluginName: parent.pluginName, prompt: input.message,
    work: () => services.provider.generate({
      prompt: conversationPrompt(history, input.message),
      system: parent.system, model: parent.model,
    }),
    responseFor: (generation) => ({ text: generation.text, model: generation.model }),
    options: { parentConversationId: parent.id, system: parent.system, model: parent.model },
  });
  sendJson(response, 200, { result });
}

interface ConversationMessageServices {
  conversationId: number;
  promptQueue: PromptQueue;
  provider: LlmProvider;
}

/** Requeues the same failed generation without changing its conversation ID.
 * Example: `POST /api/conversations/12/retry` returns conversation 12.
 */
async function retryConversation(
  _request: IncomingMessage, response: ServerResponse, services: ConversationMessageServices,
): Promise<void> {
  const failed = services.promptQueue.conversation(services.conversationId);
  if (!failed) return sendJson(response, 404, { error: "Conversation not found." });
  if (failed.status !== "failed")
    return sendJson(response, 409, { error: "Only failed conversations can be retried." });
  queueRetry(failed, services);
  return sendJson(response, 202, { conversationId: failed.id });
}

function queueRetry(failed: PromptConversation, services: ConversationMessageServices): void {
  const history = services.promptQueue.conversationHistory(failed.id) ?? [];
  const retry = services.promptQueue.retry(
    failed.id,
    () => services.provider.generate({
      prompt: retryPrompt(history, failed), system: failed.system, model: failed.model,
    }),
    (generation) => ({ text: generation.text, model: generation.model }),
  );
  void retry.catch(ignoreRetryFailure);
}

function retryPrompt(history: PromptConversation[], failed: PromptConversation): string {
  if (failed.parentConversationId === undefined) return failed.prompt;
  return conversationPrompt(history.slice(0, -1), failed.prompt);
}

function ignoreRetryFailure(): void {}

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
