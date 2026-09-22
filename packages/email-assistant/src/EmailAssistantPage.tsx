/* eslint-disable max-lines-per-function, max-len -- This page coordinates one inbox-evaluation workflow. */
import { useEffect, useState } from "react";

interface EmailEvaluation {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  description: string;
  category?: string;
  suggestedCategory?: string;
  categoryStatus?: "processing" | "suggested-new" | "suggested-existing" | "confirmed" | "failed";
  categoryError?: string;
  suggestedAction?: string;
  actionAppliedAt?: string;
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
  const [confirmingCategory, setConfirmingCategory] = useState<string>();
  const [applyingAction, setApplyingAction] = useState<string>();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

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
    try {
      const response = await fetch(
        "/api/plugins/email-assistant/evaluate-inbox",
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        result?: { evaluations: EmailEvaluation[] };
        error?: string;
      };
      if (!response.ok || !payload.result)
        throw new Error(payload.error ?? "Inbox evaluation failed.");
      setEvaluations((current) =>
        mergeEvaluations(current ?? [], payload.result?.evaluations ?? []),
      );
      void watchCategoryEvaluations();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Inbox evaluation failed.",
      );
    } finally {
      setIsRunning(false);
    }
  }
  async function disconnectGmail() {
    setIsDisconnecting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/plugins/email-assistant/disconnect", {
        method: "POST",
      });
      if (!response.ok) throw new Error("Gmail reconnection failed.");
      await loadConnection();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gmail reconnection failed.");
    } finally {
      setIsDisconnecting(false);
    }
  }
  async function watchCategoryEvaluations() {
    let hasProcessing = true;
    while (hasProcessing) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
      const response = await fetch("/api/plugins/email-assistant/evaluations");
      const payload = (await response.json()) as {
        result?: EmailEvaluation[];
        error?: string;
      };
      if (!response.ok || !payload.result)
        throw new Error(payload.error ?? "Inbox evaluation failed.");
      setEvaluations(payload.result);
      hasProcessing = payload.result.some(
        (email) => email.categoryStatus === "processing",
      );
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
        result?: { category: string; suggestedAction?: string };
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
                categoryStatus: "confirmed",
                suggestedAction: payload.result?.suggestedAction,
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
  async function applyAction(email: EmailEvaluation) {
    setApplyingAction(email.messageId);
    try {
      const response = await fetch("/api/plugins/email-assistant/apply-action", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: email.messageId }),
      });
      const payload = (await response.json()) as { result?: { appliedAt: string }; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error ?? "Action failed.");
      setEvaluations((current) => current?.map((item) => item.messageId === email.messageId ? { ...item, actionAppliedAt: payload.result?.appliedAt } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); }
    finally { setApplyingAction(undefined); }
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
          <button
            className="reconnect-gmail"
            disabled={isDisconnecting}
            onClick={() => void disconnectGmail()}
            type="button"
          >
            {isDisconnecting ? "Disconnecting…" : "Reconnect Gmail"}
          </button>
        </>
      )}
      {error && <div className="notice error">{error}</div>}
      {evaluations && (
        <div className="email-results">
          <p className="results-summary">
            {resultSummary(evaluations)}
          </p>
          {evaluations.length > 0 && (
            <div className="email-evaluation-list">
              {evaluations.map((email) => (
                <EmailEvaluationCard
                  email={email}
                  confirming={confirmingCategory === email.messageId}
                  applying={applyingAction === email.messageId}
                  onConfirm={confirmCategory}
                  onApply={applyAction}
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
  applying,
  onConfirm,
  onApply,
}: {
  email: EmailEvaluation;
  confirming: boolean;
  applying: boolean;
  onConfirm(email: EmailEvaluation): void;
  onApply(email: EmailEvaluation): void;
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
        {email.categoryStatus === "processing" ? (
          <span className="email-category processing">In processing</span>
        ) : email.categoryStatus === "failed" ? (
          <span className="email-category failed" title={email.categoryError}>
            Category evaluation failed
          </span>
        ) : email.suggestedCategory && email.categoryStatus === "suggested-new" ? (
          <button
            className="email-category suggested"
            disabled={confirming}
            onClick={() => onConfirm(email)}
            type="button"
          >
            {confirming
              ? "Creating…"
              : `Create “${email.suggestedCategory}”`}
          </button>
        ) : email.suggestedCategory ? (
          <button
            className="email-category suggested"
            disabled={confirming}
            onClick={() => onConfirm(email)}
            type="button"
          >
            {confirming
              ? "Confirming…"
              : `Confirm existing “${email.suggestedCategory}”`}
          </button>
        ) : (
          <span className="email-category">
            {email.category ?? "Uncategorized"}
          </span>
        )}
      </div>
      <h3>{email.subject || "No subject"}</h3>
      <p>{email.description}</p>
      {email.suggestedAction && (
        <p className="email-action">
          {email.actionAppliedAt ? "Action applied: " : "Suggested action: "}{formatAction(email.suggestedAction)}
          {!email.actionAppliedAt && <button className="email-category suggested" disabled={applying} onClick={() => onApply(email)} type="button">{applying ? "Applying…" : "Apply action"}</button>}
        </p>
      )}
    </article>
  );
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
function formatAction(value: string): string {
  if (value === "star") return "Star";
  if (value === "trash") return "Move to trash";
  return value.startsWith("archive:")
    ? `Archive in ${value.slice("archive:".length)}`
    : value;
}
function resultSummary(
  evaluations: EmailEvaluation[],
): string {
  const processing = evaluations.filter(
    (email) => email.categoryStatus === "processing",
  ).length;
  if (processing)
    return `${processing} category evaluation${processing === 1 ? " is" : "s are"} in processing.`;
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
