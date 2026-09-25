import type { JsonSettingValue, PluginStorage, ToolCallRecord } from "@jojo-claw/core";

export type PromptStatus = "queued" | "running" | "succeeded" | "failed";

export interface PromptQueueEntry {
  id: number;
  pluginName: string;
  prompt: string;
  status: PromptStatus;
}

/** A durable record of one model request and its eventual response.
 * Example: `queue.conversations()` returns previously completed requests.
 */
export interface PromptConversation extends PromptQueueEntry {
  createdAt: string;
  completedAt?: string;
  response?: PromptResponse;
  failureReason?: string;
  parentConversationId?: number;
  system?: string;
  model?: string;
}

const conversationStorageKey = "conversations";

/** Serializes model calls and exposes their current state to the local UI.
 * Example: `await queue.enqueue("Text generation", "Summarize this", generate)`.
 */
export class PromptQueue {
  private entries: PromptConversation[];
  private nextId: number;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly storage: PluginStorage) {
    this.entries = restoreConversations(storage.get<PromptConversation[]>(conversationStorageKey));
    this.nextId = nextConversationId(this.entries);
    this.finishInterruptedConversations();
  }

  enqueue<Result>(job: PromptQueueJob<Result>): Promise<Result> {
    const entry = this.createEntry(job.pluginName, job.prompt, job.options ?? {});
    job.onCreated?.(entry.id);
    return this.schedule(entry, job.work, job.responseFor);
  }

  /** Places a failed request at the end of the queue without changing its identity.
   * Example: `queue.retry(12, generate, responseFor)` reuses conversation 12.
   */
  retry<Result>(
    id: number, work: () => Promise<Result>, responseFor: (result: Result) => PromptResponse,
  ): Promise<Result> {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) {
      throw new Error(`Cannot retry conversation ${id}; expected an existing conversation.`);
    }
    if (entry.status !== "failed")
      throw new Error(`Cannot retry conversation ${id}; expected status failed.`);
    entry.status = "queued";
    entry.failureReason = undefined;
    entry.completedAt = undefined;
    entry.response = undefined;
    this.persist();
    return this.schedule(entry, work, responseFor);
  }

  snapshot(): PromptQueueEntry[] {
    return this.entries.map(copyEntry);
  }

  conversations(): PromptConversation[] {
    return this.entries.map(copyConversation);
  }

  conversation(id: number): PromptConversation | undefined {
    const entry = this.entries.find((candidate) => candidate.id === id);
    return entry && copyConversation(entry);
  }

  conversationHistory(id: number): PromptConversation[] | undefined {
    const entry = this.conversation(id);
    if (!entry) return undefined;
    return this.ancestorIds(entry).map((ancestorId) => this.conversation(ancestorId)!);
  }

  recordToolCallResult(conversationId: number | undefined, call: ToolCallRecord): void {
    const entry = conversationId === undefined
      ? latestConversationWithToolCall(this.entries, call.id)
      : this.entries.find((candidate) => candidate.id === conversationId);
    const recordedCall = entry?.response?.toolCalls?.find((candidate) => candidate.id === call.id);
    if (!recordedCall) return;
    recordedCall.result = call.result;
    this.persist();
  }

  private createEntry(
    pluginName: string,
    prompt: string,
    options: ConversationOptions,
  ): PromptConversation {
    const entry: PromptConversation = {
      id: this.nextId++, pluginName, prompt, status: "queued", createdAt: new Date().toISOString(),
      parentConversationId: options.parentConversationId,
      system: options.system,
      model: options.model,
    };
    this.entries.push(entry);
    this.persist();
    return entry;
  }

  private async run<Result>(
    entry: PromptConversation,
    work: () => Promise<Result>,
    responseFor: (result: Result) => { text: string; model: string },
  ): Promise<Result> {
    entry.status = "running";
    this.persist();
    try {
      const result = await work();
      entry.status = "succeeded";
      entry.response = responseFor(result);
      entry.completedAt = new Date().toISOString();
      this.persist();
      return result;
    } catch (error) {
      entry.status = "failed";
      entry.failureReason = error instanceof Error
        ? error.message
        : "Unexpected generation failure.";
      entry.completedAt = new Date().toISOString();
      this.persist();
      throw error;
    }
  }

  private schedule<Result>(
    entry: PromptConversation,
    work: () => Promise<Result>,
    responseFor: (result: Result) => PromptResponse,
  ): Promise<Result> {
    const task = this.tail.then(() => this.run(entry, work, responseFor));
    this.tail = task.then(clearQueueTail, clearQueueTail);
    return task;
  }

  private finishInterruptedConversations(): void {
    const interrupted = this.entries.filter((entry) =>
      entry.status === "queued" || entry.status === "running",
    );
    if (interrupted.length === 0) return;
    for (const entry of interrupted) {
      entry.status = "failed";
      entry.failureReason = "Generation was interrupted by a server restart.";
      entry.completedAt = new Date().toISOString();
    }
    this.persist();
  }

  private persist(): void {
    this.storage.set(conversationStorageKey, this.entries);
  }

  private ancestorIds(entry: PromptConversation): number[] {
    const ids: number[] = [];
    let current: PromptConversation | undefined = entry;
    while (current) {
      ids.unshift(current.id);
      current = current.parentConversationId === undefined
        ? undefined
        : this.entries.find((candidate) => candidate.id === current?.parentConversationId);
    }
    return ids;
  }
}

function hasRequestedToolCall(entry: PromptConversation, callId: string): boolean {
  return entry.response?.toolCalls?.some((call) => call.id === callId) ?? false;
}

function latestConversationWithToolCall(
  entries: PromptConversation[], callId: string,
): PromptConversation | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1)
    if (hasRequestedToolCall(entries[index]!, callId)) return entries[index];
  return undefined;
}

export interface ConversationOptions {
  parentConversationId?: number;
  system?: string;
  model?: string;
}

export interface PromptQueueJob<Result> {
  pluginName: string;
  prompt: string;
  work: () => Promise<Result>;
  responseFor: (result: Result) => PromptResponse;
  options?: ConversationOptions;
  onCreated?(conversationId: number): void;
}

export interface PromptResponse {
  text: string;
  model: string;
  toolCalls?: PersistedToolCall[];
}

export interface PersistedToolCall {
  id: string;
  name: string;
  arguments: Record<string, JsonSettingValue>;
  result?: string;
}

function clearQueueTail(): void {}

function copyEntry(entry: PromptQueueEntry): PromptQueueEntry {
  return { id: entry.id, pluginName: entry.pluginName, prompt: entry.prompt, status: entry.status };
}

function copyConversation(entry: PromptConversation): PromptConversation {
  const conversation: PromptConversation = {
    ...copyEntry(entry),
    createdAt: entry.createdAt,
    completedAt: entry.completedAt,
    response: entry.response && copyResponse(entry.response),
    failureReason: entry.failureReason,
  };
  if (entry.parentConversationId !== undefined)
    conversation.parentConversationId = entry.parentConversationId;
  if (entry.system !== undefined) conversation.system = entry.system;
  if (entry.model !== undefined) conversation.model = entry.model;
  return conversation;
}

function copyResponse(response: PromptResponse): PromptResponse {
  return {
    ...response,
    toolCalls: response.toolCalls?.map((call) => ({
      ...call,
      arguments: { ...call.arguments },
    })),
  };
}

function restoreConversations(value: PromptConversation[] | undefined): PromptConversation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isConversation).map(copyConversation);
}

function isConversation(value: unknown): value is PromptConversation {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return Number.isInteger(entry.id) && typeof entry.pluginName === "string"
    && typeof entry.prompt === "string" && isPromptStatus(entry.status)
    && typeof entry.createdAt === "string"
    && optionalNumber(entry.parentConversationId)
    && optionalString(entry.system) && optionalString(entry.model);
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || Number.isInteger(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isPromptStatus(value: unknown): value is PromptStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed";
}

function nextConversationId(entries: PromptConversation[]): number {
  return entries.reduce((nextId, entry) => Math.max(nextId, entry.id + 1), 1);
}
