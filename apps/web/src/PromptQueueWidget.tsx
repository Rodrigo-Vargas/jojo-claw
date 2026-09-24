import { useEffect, useRef, useState } from "react";
import {
  browserNotifications,
  notifyQueueDrained,
  queueJustDrained,
} from "./queue-empty-notification.js";

interface PromptQueueItem {
  id: number;
  pluginName: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed";
}

interface PromptQueueResponse {
  items: PromptQueueItem[];
}

/** Renders the local model queue, refreshed while users work.
 * Example: `<PromptQueueWidget />`.
 */
export function PromptQueueWidget() {
  const [items, setItems] = useState<PromptQueueItem[]>([]);
  const [error, setError] = useState<string>();
  const previousActiveCount = useRef<number>();

  useEffect(() => {
    void loadPromptQueue(setItems, setError);
    const timer = window.setInterval(() => void loadPromptQueue(setItems, setError), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeCount = items.filter(isActive).length;
  useEffect(() => {
    const previousCount = previousActiveCount.current;
    previousActiveCount.current = activeCount;
    if (previousCount === undefined || !queueJustDrained(previousCount, activeCount)) return;
    const notifications = browserNotifications(window);
    if (notifications) notifyQueueDrained(notifications);
  }, [activeCount]);

  return (
    <aside className="details prompt-queue" aria-label="Prompt queue">
      <div className="queue-heading">
        <div>
          <h2>Prompt queue</h2>
          <p className="details-intro">Model requests waiting or recently completed.</p>
        </div>
        <span className="queue-count" aria-label={`${activeCount} active prompts`}>
          {activeCount}
        </span>
      </div>
      {items.length === 0 && <p className="muted">No prompts in the queue.</p>}
      <div className="queue-list">
        {items.slice().reverse().map((item) => <QueueItem item={item} key={item.id} />)}
      </div>
      {error && <div className="notice error">{error}</div>}
    </aside>
  );
}

function QueueItem({ item }: { item: PromptQueueItem }) {
  return (
    <article className="queue-item">
      <span className={`queue-state ${item.status}`} aria-hidden="true" />
      <div>
        <div className="queue-item-heading">
          <strong>{item.pluginName}</strong>
          <span>{statusLabel(item.status)}</span>
        </div>
        <p title={item.prompt}>{promptPreview(item.prompt)}</p>
      </div>
    </article>
  );
}

async function loadPromptQueue(
  setItems: (items: PromptQueueItem[]) => void,
  setError: (error: string | undefined) => void,
): Promise<void> {
  try {
    const response = await fetch("/api/prompt-queue");
    if (!response.ok) throw new Error("Could not load the prompt queue.");
    const payload = await response.json() as PromptQueueResponse;
    setItems(payload.items);
    setError(undefined);
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : "Could not load the prompt queue.");
  }
}

function isActive(item: PromptQueueItem): boolean {
  return item.status === "queued" || item.status === "running";
}

function statusLabel(status: PromptQueueItem["status"]): string {
  return status === "succeeded" ? "Complete" : status[0].toUpperCase() + status.slice(1);
}

function promptPreview(prompt: string): string {
  return prompt.length > 88 ? `${prompt.slice(0, 88)}…` : prompt;
}
