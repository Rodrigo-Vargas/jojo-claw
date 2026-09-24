import type { PluginStorage } from "@jojo-claw/core";

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
  response?: { text: string; model: string };
  failureReason?: string;
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

  enqueue<Result>(
    pluginName: string,
    prompt: string,
    work: () => Promise<Result>,
    responseFor: (result: Result) => { text: string; model: string },
  ): Promise<Result> {
    const entry = this.createEntry(pluginName, prompt);
    const task = this.tail.then(() => this.run(entry, work, responseFor));
    this.tail = task.then(clearQueueTail, clearQueueTail);
    return task;
  }

  snapshot(): PromptQueueEntry[] {
    return this.entries.map(copyEntry);
  }

  conversations(): PromptConversation[] {
    return this.entries.map(copyConversation);
  }

  private createEntry(pluginName: string, prompt: string): PromptConversation {
    const entry: PromptConversation = {
      id: this.nextId++, pluginName, prompt, status: "queued", createdAt: new Date().toISOString(),
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
}

function clearQueueTail(): void {}

function copyEntry(entry: PromptQueueEntry): PromptQueueEntry {
  return { id: entry.id, pluginName: entry.pluginName, prompt: entry.prompt, status: entry.status };
}

function copyConversation(entry: PromptConversation): PromptConversation {
  return {
    ...copyEntry(entry),
    createdAt: entry.createdAt,
    completedAt: entry.completedAt,
    response: entry.response && { ...entry.response },
    failureReason: entry.failureReason,
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
    && typeof entry.createdAt === "string";
}

function isPromptStatus(value: unknown): value is PromptStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed";
}

function nextConversationId(entries: PromptConversation[]): number {
  return entries.reduce((nextId, entry) => Math.max(nextId, entry.id + 1), 1);
}
