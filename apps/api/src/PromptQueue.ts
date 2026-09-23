export type PromptStatus = "queued" | "running" | "succeeded" | "failed";

export interface PromptQueueEntry {
  id: number;
  pluginName: string;
  prompt: string;
  status: PromptStatus;
}

/** Serializes model calls and exposes their current state to the local UI.
 * Example: `await queue.enqueue("Text generation", "Summarize this", generate)`.
 */
export class PromptQueue {
  private entries: PromptQueueEntry[] = [];
  private nextId = 1;
  private tail: Promise<void> = Promise.resolve();

  enqueue<Result>(
    pluginName: string,
    prompt: string,
    work: () => Promise<Result>,
  ): Promise<Result> {
    const entry = this.createEntry(pluginName, prompt);
    const task = this.tail.then(() => this.run(entry, work));
    this.tail = task.then(clearQueueTail, clearQueueTail);
    return task;
  }

  snapshot(): PromptQueueEntry[] {
    this.removeExpiredEntries();
    return this.entries.map(copyEntry);
  }

  private createEntry(pluginName: string, prompt: string): PromptQueueEntry {
    const entry: PromptQueueEntry = { id: this.nextId++, pluginName, prompt, status: "queued" };
    this.entries.push(entry);
    return entry;
  }

  private async run<Result>(
    entry: PromptQueueEntry,
    work: () => Promise<Result>,
  ): Promise<Result> {
    entry.status = "running";
    try {
      const result = await work();
      entry.status = "succeeded";
      return result;
    } catch (error) {
      entry.status = "failed";
      throw error;
    }
  }

  private removeExpiredEntries(): void {
    const firstRetainedEntry = Math.max(0, this.entries.length - 25);
    this.entries = this.entries.filter((entry, index) =>
      entry.status === "queued" || entry.status === "running" || index >= firstRetainedEntry,
    );
  }
}

function clearQueueTail(): void {}

function copyEntry(entry: PromptQueueEntry): PromptQueueEntry {
  return { id: entry.id, pluginName: entry.pluginName, prompt: entry.prompt, status: entry.status };
}
