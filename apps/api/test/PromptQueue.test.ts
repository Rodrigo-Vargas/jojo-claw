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
      queue.enqueue({ pluginName: "Text generation", prompt: "Fail safely.", work: failGeneration, responseFor: responseFromText }),
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

  it("requeues a failed generation without creating another conversation", async () => {
    const queue = new PromptQueue(new MemoryPluginStorage());
    await assert.rejects(queue.enqueue({
      pluginName: "Text generation", prompt: "Try again.",
      work: failGeneration, responseFor: responseFromText,
    }));

    const retried = queue.retry(1, successfulGeneration, responseFromText);

    assert.equal(queue.conversations()[0]?.status, "queued");
    await assert.doesNotReject(retried);
    assert.deepEqual(queue.conversations(), [{
      id: 1, pluginName: "Text generation", prompt: "Try again.", status: "succeeded",
      createdAt: queue.conversations()[0]?.createdAt,
      completedAt: queue.conversations()[0]?.completedAt,
      response: { text: "Recovered.", model: "test-model", toolCalls: undefined },
      failureReason: undefined,
    }]);
  });

  it("replays a successful generation without creating another conversation", async () => {
    const queue = new PromptQueue(new MemoryPluginStorage());
    await queue.enqueue({
      pluginName: "Text generation", prompt: "Try again.",
      work: successfulGeneration, responseFor: responseFromText,
    });

    await queue.replay(1, successfulGeneration, responseFromText);

    assert.equal(queue.conversations().length, 1);
    assert.equal(queue.conversation(1)?.status, "succeeded");
  });

  it("replaces a prompt and removes its descendant conversations", async () => {
    const queue = new PromptQueue(new MemoryPluginStorage());
    await queue.enqueue({
      pluginName: "Text generation", prompt: "Original", work: successfulGeneration,
      responseFor: responseFromText,
    });
    await queue.enqueue({
      pluginName: "Text generation", prompt: "Follow-up", work: successfulGeneration,
      responseFor: responseFromText, options: { parentConversationId: 1 },
    });

    await queue.replacePrompt(1, "Edited", successfulGeneration, responseFromText);

    assert.deepEqual(queue.conversations().map((conversation) => ({
      id: conversation.id, prompt: conversation.prompt, status: conversation.status,
    })), [{ id: 1, prompt: "Edited", status: "succeeded" }]);
  });

  it("lists completed conversations by most recently processed first", () => {
    const storage = new MemoryPluginStorage();
    storage.set("conversations", [
      completedConversation(1, "2026-09-24T12:00:00.000Z"),
      completedConversation(2, "2026-09-24T12:02:00.000Z"),
      completedConversation(3, "2026-09-24T12:01:00.000Z"),
    ]);

    const queue = new PromptQueue(storage);

    assert.deepEqual(queue.snapshot().map((entry) => entry.id), [2, 3, 1]);
  });
});

async function failGeneration(): Promise<{ text: string; model: string }> {
  throw new Error("Provider unavailable.");
}

async function successfulGeneration(): Promise<{ text: string; model: string }> {
  return { text: "Recovered.", model: "test-model" };
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

function completedConversation(id: number, completedAt: string): PromptConversation {
  return {
    ...activeConversation(), id, status: "succeeded", completedAt,
    response: { text: "Done.", model: "test-model" },
  };
}
