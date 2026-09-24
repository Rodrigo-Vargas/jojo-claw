import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  notifyQueueDrained,
  queueJustDrained,
  type BrowserNotifications,
} from "../src/queue-empty-notification.js";

class FakeBrowserNotifications implements BrowserNotifications {
  permission: NotificationPermission = "granted";
  readonly calls: Array<{ title: string; options: NotificationOptions }> = [];

  notify(title: string, options: NotificationOptions): void {
    this.calls.push({ title, options });
  }
}

describe("queue empty notification", () => {
  it("detects only a transition from active prompts to an empty queue", () => {
    assert.equal(queueJustDrained(0, 0), false);
    assert.equal(queueJustDrained(2, 1), false);
    assert.equal(queueJustDrained(1, 0), true);
  });

  it("notifies only when the browser has granted permission", () => {
    const notifications = new FakeBrowserNotifications();
    notifyQueueDrained(notifications);
    notifications.permission = "denied";
    notifyQueueDrained(notifications);
    assert.deepEqual(notifications.calls, [{
      title: "Prompt queue is empty",
      options: { body: "All prompts are complete. Return to Jojo Claw to queue more inputs." },
    }]);
  });
});
