export interface BrowserNotifications {
  permission: NotificationPermission;
  notify(title: string, options: NotificationOptions): void;
}

/** Returns whether a queue that was processing prompts has finished.
 * Example: `queueJustDrained(1, 0)` returns `true`.
 */
export function queueJustDrained(previousActiveCount: number, activeCount: number): boolean {
  return previousActiveCount > 0 && activeCount === 0;
}

/** Shows a completion notification when browser notifications are enabled.
 * Example: `notifyQueueDrained(browserNotifications)`.
 */
export function notifyQueueDrained(notifications: BrowserNotifications): void {
  if (notifications.permission !== "granted") return;
  notifications.notify("Prompt queue is empty", {
    body: "All prompts are complete. Return to Jojo Claw to queue more inputs.",
  });
}

/** Adapts the browser Notification API to the queue notification boundary.
 * Example: `browserNotifications(window)`.
 */
export function browserNotifications(browserWindow: Window): BrowserNotifications | undefined {
  const notificationApi = notificationConstructor(browserWindow);
  if (!notificationApi) return undefined;
  return {
    permission: notificationApi.permission,
    notify: (title, options) => new notificationApi(title, options),
  };
}

function notificationConstructor(browserWindow: Window): typeof Notification | undefined {
  return (browserWindow as unknown as { Notification?: typeof Notification }).Notification;
}
