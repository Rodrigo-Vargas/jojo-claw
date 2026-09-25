/* eslint-disable max-lines-per-function, max-len -- This page coordinates one inbox-evaluation workflow. */
import { useEffect, useState } from "react";
import {
  EmailEvaluationCard,
  type EmailEvaluation,
} from "./components/EmailEvaluationCard.js";

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
  const [retryingClassification, setRetryingClassification] = useState<string>();
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
  async function retryClassification(email: EmailEvaluation) {
    setRetryingClassification(email.messageId);
    setError(undefined);
    try {
      const response = await fetch(
        "/api/plugins/email-assistant/retry-classification",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageId: email.messageId }),
        },
      );
      const payload = (await response.json()) as {
        result?: { evaluation: EmailEvaluation };
        error?: string;
      };
      if (!response.ok || !payload.result)
        throw new Error(payload.error ?? "Classification retry failed.");
      setEvaluations((current) => current?.map((item) =>
        item.messageId === email.messageId ? payload.result?.evaluation ?? item : item,
      ));
      void watchCategoryEvaluations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Classification retry failed.");
    } finally {
      setRetryingClassification(undefined);
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
        result?: { category: string; suggestedActions?: string[]; promptProposal?: string };
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
                suggestedActions: payload.result?.suggestedActions,
                categoryPromptProposal: payload.result?.promptProposal,
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
                  retrying={retryingClassification === email.messageId}
                  onConfirm={confirmCategory}
                  onApply={applyAction}
                  onRetry={retryClassification}
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
      b.receivedAt.localeCompare(a.receivedAt) ||
      a.messageId.localeCompare(b.messageId),
  );
}
