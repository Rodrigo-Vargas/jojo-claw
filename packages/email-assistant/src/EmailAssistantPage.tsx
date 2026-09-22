/* eslint-disable max-lines-per-function -- This page coordinates one inbox-evaluation workflow. */
import { useEffect, useState } from "react";

interface EmailEvaluation {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  description: string;
  category?: string;
  suggestedCategory?: string;
}
interface InboxEvaluationProgress {
  state: "running" | "complete" | "failed";
  total: number;
  read: number;
  evaluations: EmailEvaluation[];
  error?: string;
}

/** Renders saved and newly evaluated Gmail Inbox messages.
 * Example: `<EmailAssistantPage />`.
 */
export default function EmailAssistantPage() {
  const [connection, setConnection] = useState<{
    configured: boolean;
    connected: boolean;
    email?: string;
  }>();
  const [evaluations, setEvaluations] = useState<EmailEvaluation[]>();
  const [error, setError] = useState<string>();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<InboxEvaluationProgress>();
  const [confirmingCategory, setConfirmingCategory] = useState<string>();

  useEffect(() => {
    void Promise.all([loadConnection(), loadEvaluations()]);
  }, []);

  async function loadConnection() {
    try {
      const response = await fetch("/api/plugins/email-assistant/status");
      const payload = (await response.json()) as {
        result?: { configured: boolean; connected: boolean; email?: string };
      };
      if (response.ok && payload.result) setConnection(payload.result);
    } catch {
      /* The evaluation action exposes connection failures with a useful message. */
    }
  }
  async function loadEvaluations() {
    try {
      const response = await fetch("/api/plugins/email-assistant/evaluations");
      const payload = (await response.json()) as { result?: EmailEvaluation[] };
      if (response.ok && payload.result) setEvaluations(payload.result);
    } catch {
      /* Loading saved evaluations is optional while the connection is being configured. */
    }
  }

  async function evaluateInbox() {
    setIsRunning(true);
    setError(undefined);
    setProgress({ state: "running", total: 0, read: 0, evaluations: [] });
    try {
      const response = await fetch(
        "/api/plugins/email-assistant/evaluate-inbox",
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        result?: { evaluationId: string };
        error?: string;
      };
      if (!response.ok || !payload.result)
        throw new Error(payload.error ?? "Inbox evaluation failed.");
      await watchEvaluation(payload.result.evaluationId);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Inbox evaluation failed.",
      );
    } finally {
      setIsRunning(false);
    }
  }
  async function watchEvaluation(evaluationId: string) {
    while (true) {
      const progressPath = "/api/plugins/email-assistant/evaluation-progress";
      const url = `${progressPath}?evaluationId=${encodeURIComponent(evaluationId)}`;
      const response = await fetch(url);
      const payload = (await response.json()) as {
        result?: InboxEvaluationProgress;
        error?: string;
      };
      if (!response.ok || !payload.result)
        throw new Error(payload.error ?? "Inbox evaluation failed.");
      setProgress(payload.result);
      const newEvaluations = payload.result.evaluations;
      setEvaluations((current) =>
        mergeEvaluations(current ?? [], newEvaluations),
      );
      if (payload.result.state === "complete") {
        return;
      }
      if (payload.result.state === "failed")
        throw new Error(payload.result.error ?? "Inbox evaluation failed.");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
    }
  }
  async function confirmCategory(email: EmailEvaluation) {
    if (!email.suggestedCategory) return;
    setConfirmingCategory(email.messageId);
    setError(undefined);
    try {
      const response = await fetch(
        "/api/plugins/email-assistant/confirm-category",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: email.suggestedCategory,
            messageId: email.messageId,
          }),
        },
      );
      const payload = (await response.json()) as {
        result?: { category: string };
        error?: string;
      };
      if (!response.ok || !payload.result)
        throw new Error(payload.error ?? "Category confirmation failed.");
      setEvaluations((current) =>
        current?.map((item) =>
          item.messageId === email.messageId
            ? {
                ...item,
                category: payload.result?.category,
                suggestedCategory: undefined,
              }
            : item,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Category confirmation failed.",
      );
    } finally {
      setConfirmingCategory(undefined);
    }
  }

  return (
    <section className="conversation email-assistant-page">
      <div className="intro">
        <div className="plugin-icon">✉</div>
        <div>
          <h2>Evaluate your inbox</h2>
          <p>
            Recent inbox messages are summarized and classified one at a time.
            Set the available categories in Settings.
          </p>
        </div>
      </div>
      {!connection?.configured && (
        <p className="notice error">
          Set the Google OAuth client ID in Secrets before connecting Gmail.
        </p>
      )}
      {connection?.configured && !connection.connected && (
        <a
          className="evaluate-inbox"
          href="/api/plugins/email-assistant/connect"
        >
          Connect Gmail
        </a>
      )}
      {connection?.connected && (
        <>
          <p className="connection-note">
            Connected as {connection.email ?? "your Google account"}.
          </p>
          <button
            className="evaluate-inbox"
            onClick={() => void evaluateInbox()}
            disabled={isRunning}
            type="button"
          >
            {isRunning ? "Evaluating inbox…" : "Evaluate 10 more emails"}
          </button>
        </>
      )}
      {progress?.state === "running" && (
        <div className="evaluation-progress" aria-live="polite">
          <div>
            <strong>
              {progress.total
                ? `${progress.read} of ${progress.total} emails read`
                : "Finding inbox emails…"}
            </strong>
            <span>
              {progress.total
                ? `${Math.round((progress.read / progress.total) * 100)}%`
                : ""}
            </span>
          </div>
          <progress value={progress.read} max={Math.max(progress.total, 1)} />
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      {evaluations && (
        <div className="email-results">
          <p className="results-summary">
            {resultSummary(evaluations, progress?.state)}
          </p>
          {evaluations.length > 0 && (
            <div className="email-evaluation-list">
              {evaluations.map((email) => (
                <EmailEvaluationCard
                  email={email}
                  confirming={confirmingCategory === email.messageId}
                  onConfirm={confirmCategory}
                  key={email.messageId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EmailEvaluationCard({
  email,
  confirming,
  onConfirm,
}: {
  email: EmailEvaluation;
  confirming: boolean;
  onConfirm(email: EmailEvaluation): void;
}) {
  return (
    <article className="email-evaluation">
      <div className="email-evaluation-heading">
        <div>
          <strong>{email.from || "Unknown sender"}</strong>
          <time dateTime={email.receivedAt}>
            {formatDate(email.receivedAt)}
          </time>
        </div>
        {email.suggestedCategory ? (
          <button
            className="email-category suggested"
            disabled={confirming}
            onClick={() => onConfirm(email)}
            type="button"
          >
            {confirming
              ? "Confirming…"
              : `Confirm “${email.suggestedCategory}”`}
          </button>
        ) : (
          <span className="email-category">
            {email.category ?? "Uncategorized"}
          </span>
        )}
      </div>
      <h3>{email.subject || "No subject"}</h3>
      <p>{email.description}</p>
    </article>
  );
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
function resultSummary(
  evaluations: EmailEvaluation[],
  state: InboxEvaluationProgress["state"] | undefined,
): string {
  if (state === "running")
    return `${evaluations.length} result${evaluations.length === 1 ? "" : "s"} ready.`;
  if (evaluations.length === 0) return "No inbox messages found.";
  return `${evaluations.length} saved inbox message${evaluations.length === 1 ? "" : "s"}.`;
}
function mergeEvaluations(
  current: EmailEvaluation[],
  incoming: EmailEvaluation[],
): EmailEvaluation[] {
  const evaluations = new Map(current.map((email) => [email.messageId, email]));
  for (const email of incoming) evaluations.set(email.messageId, email);
  return [...evaluations.values()].sort(
    (a, b) =>
      a.receivedAt.localeCompare(b.receivedAt) ||
      a.messageId.localeCompare(b.messageId),
  );
}
