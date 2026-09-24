import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginStorage } from "@jojo-claw/core";
import { PromptQueue, type PromptConversation } from "../src/PromptQueue.js";

class MemoryPluginStorage implements PluginStorage {
  private records = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.records.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.records.set(key, value);
  }

  delete(key: string): void {
    this.records.delete(key);
  }

  entries<T>(): Array<{ key: string; value: T }> {
    return [...this.records.entries()].map(([key, value]) => ({ key, value: value as T }));
  }
}

describe("PromptQueue", () => {
  it("records a failed generation for later retrieval", async () => {
    const queue = new PromptQueue(new MemoryPluginStorage());

    await assert.rejects(
      queue.enqueue("Text generation", "Fail safely.", failGeneration, responseFromText),
      /Provider unavailable/,
    );

    const [conversation] = queue.conversations();
    assert.equal(conversation?.status, "failed");
    assert.equal(conversation?.failureReason, "Provider unavailable.");
    assert.equal(typeof conversation?.completedAt, "string");
  });

  it("marks work left active by a restart as failed", () => {
    const storage = new MemoryPluginStorage();
    storage.set("conversations", [activeConversation()]);

    const queue = new PromptQueue(storage);

    assert.deepEqual(queue.conversations(), [{
      ...activeConversation(),
      status: "failed",
      completedAt: queue.conversations()[0]?.completedAt,
      response: undefined,
      failureReason: "Generation was interrupted by a server restart.",
    }]);
    assert.equal(typeof queue.conversations()[0]?.completedAt, "string");
  });
});

async function failGeneration(): Promise<{ text: string; model: string }> {
  throw new Error("Provider unavailable.");
}

function responseFromText(result: { text: string; model: string }): { text: string; model: string } {
  return result;
}

function activeConversation(): PromptConversation {
  return {
    id: 4,
    pluginName: "Text generation",
    prompt: "Resume this.",
    status: "running",
    createdAt: "2026-09-24T12:00:00.000Z",
  };
}
