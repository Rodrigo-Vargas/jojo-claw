import type {
  GenerateTextInput,
  GenerateTextResult,
  GenerateWithToolsInput,
  GenerateWithToolsResult,
  JsonSettingValue,
  LlmProvider,
  ToolCall,
  ToolDefinition,
  ToolMessage,
} from "@jojo-claw/core";

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  error?: string;
}

interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> };
}

interface OllamaToolDefinition {
  type: "function";
  function: ToolDefinition;
}

type OllamaMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: OllamaToolCall[] }
  | { role: "tool"; content: string };

export interface OllamaProviderOptions {
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
}

/** Owns Ollama's wire format so plugin applications never need to. */
export class OllamaProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly request: typeof fetch;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.OLLAMA_BASE_URL ??
      "http://127.0.0.1:11434"
    ).replace(/\/$/, "");
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? "llama3.2";
    this.request = options.fetch ?? fetch;
  }

  async generate(input: GenerateTextInput): Promise<GenerateTextResult> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("prompt is required.");
    const model = input.model?.trim() || this.model;
    const messages = [
      ...(input.system?.trim()
        ? [{ role: "system", content: input.system.trim() }]
        : []),
      { role: "user", content: prompt },
    ];
    const response = await this.request(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    const payload = (await response.json()) as OllamaChatResponse;
    if (!response.ok)
      throw new Error(
        payload.error ?? `Ollama returned HTTP ${response.status}.`,
      );
    const text = payload.message?.content;
    if (!text) throw new Error("Ollama returned no text.");
    return { text, model: payload.model ?? model };
  }

  async generateWithTools(
    input: GenerateWithToolsInput,
  ): Promise<GenerateWithToolsResult> {
    const model = input.model?.trim() || this.model;
    const response = await this.request(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: toOllamaMessages(input.messages),
        tools: toOllamaTools(input.tools),
        stream: false,
      }),
    });
    const payload = (await response.json()) as OllamaChatResponse;
    if (!response.ok)
      throw new Error(
        payload.error ?? `Ollama returned HTTP ${response.status}.`,
      );
    const message = payload.message;
    if (!message) throw new Error("Ollama returned no message.");
    return {
      text: message.content ?? "",
      model: payload.model ?? model,
      toolCalls: parseToolCalls(message.tool_calls ?? []),
    };
  }
}

function parseToolCalls(calls: OllamaToolCall[]): ToolCall[] {
  return calls.flatMap((call, index) => {
    const name = call.function?.name;
    const argumentsValue = call.function?.arguments;
    if (!name || !argumentsValue || !isJsonRecord(argumentsValue))
      throw new Error(
        `Ollama returned invalid tool call at index ${index}; ` +
          "expected a function name and object arguments.",
      );
    return [{ id: `ollama-${index}`, name, arguments: argumentsValue }];
  });
}

function toOllamaTools(tools: ToolDefinition[]): OllamaToolDefinition[] {
  return tools.map((tool) => ({ type: "function", function: tool }));
}

function toOllamaMessages(messages: ToolMessage[]): OllamaMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") {
      if (message.role === "tool") return { role: "tool", content: message.content };
      return message;
    }
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls
        ? { tool_calls: message.toolCalls.map(toOllamaToolCall) }
        : {}),
    };
  });
}

function toOllamaToolCall(call: ToolCall): OllamaToolCall {
  return { function: { name: call.name, arguments: call.arguments } };
}

function isJsonRecord(
  value: Record<string, unknown>,
): value is Record<string, JsonSettingValue> {
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(
  value: unknown,
): value is JsonSettingValue {
  if (value === null || typeof value === "string") return true;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return (
    typeof value === "object" &&
    value !== null &&
    isJsonRecord(value as Record<string, unknown>)
  );
}
