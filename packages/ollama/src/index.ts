import type {
  GenerateTextInput,
  GenerateTextResult,
  LlmProvider,
} from "@jojo-claw/core";

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string };
  error?: string;
}

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
}
