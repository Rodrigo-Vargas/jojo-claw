import { type FormEvent, useEffect, useState } from "react";

type PromptStatus = "queued" | "running" | "succeeded" | "failed";

interface ConversationTurn {
  id: number;
  prompt: string;
  status: PromptStatus;
  response?: {
    text: string;
    model: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown>; result?: string }>;
  };
  failureReason?: string;
}

interface ConversationResponse {
  conversation: ConversationTurn;
  messages: ConversationTurn[];
}

/** Shows a persisted model conversation and permits the next user turn.
 * Example: `<ConversationPage conversationId={12} />`.
 */
export function ConversationPage({ conversationId }: { conversationId: number }) {
  const [conversation, setConversation] = useState<ConversationResponse>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>();
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    void loadConversation(conversationId, setConversation, setError);
    const timer = window.setInterval(
      () => void loadConversation(conversationId, setConversation, setError), 1000,
    );
    return () => window.clearInterval(timer);
  }, [conversationId]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !message.trim()) return;
    setIsSending(true);
    setError(undefined);
    try {
      await postMessage(conversationId, message);
      setMessage("");
      await loadConversation(conversationId, setConversation, setError);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send message.");
    } finally {
      setIsSending(false);
    }
  }

  if (!conversation)
    return <section className="conversation">
      <p className="muted">Loading conversation…</p>
    </section>;
  const latest = conversation.conversation;
  return (
    <section className="conversation conversation-detail">
      <div className="intro">
        <div className="plugin-icon">✦</div>
        <div>
          <h2>Conversation</h2>
          <p>Conversation #{latest.id} is {statusLabel(latest.status).toLowerCase()}.</p>
        </div>
      </div>
      <div className="transcript">
        {conversation.messages.map((turn) => (
          <ConversationTurnView turn={turn} key={turn.id} />
        ))}
      </div>
      {latest.status === "succeeded" && (
        <form className="composer" onSubmit={sendMessage}>
          <label>
            Continue the conversation
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              required
            />
          </label>
          <div className="composer-footer">
            <span>Your message will join the end of the current queue.</span>
            <button type="submit" disabled={isSending}>
              {isSending ? "Queued…" : "Send"} <span>↑</span>
            </button>
          </div>
        </form>
      )}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}

function ConversationTurnView({ turn }: { turn: ConversationTurn }) {
  return <>
    <article className="message user-message">
      <strong>You</strong><p>{turn.prompt}</p>
    </article>
    {turn.response && <article className="response">
      <div className="response-meta">
        <span className="assistant-mark">J</span><span>Agent</span>
        <span className="model">{turn.response.model}</span>
      </div>
      {turn.response.toolCalls && <div className="tool-calls">
        <strong>Tool calls</strong>
        {turn.response.toolCalls.map((call, index) => (
          <p key={`${call.name}-${index}`}>
            <code>{call.name}({JSON.stringify(call.arguments)})</code>
            {call.result === undefined ? " requested" : ` → ${call.result}`}
          </p>
        ))}
      </div>}
      <p>{turn.response.text}</p>
    </article>}
    {turn.status === "queued" || turn.status === "running"
      ? <p className="muted">Agent is {turn.status}…</p>
      : turn.failureReason && <div className="notice error">{turn.failureReason}</div>}
  </>;
}

async function loadConversation(
  conversationId: number,
  setConversation: (conversation: ConversationResponse) => void,
  setError: (error: string | undefined) => void,
): Promise<void> {
  try {
    const response = await fetch(`/api/conversations/${conversationId}`);
    const payload = await response.json() as ConversationResponse | { error: string };
    if (!response.ok || "error" in payload)
      throw new Error(
        "error" in payload ? payload.error : "Could not load conversation.",
      );
    setConversation(payload);
    setError(undefined);
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : "Could not load conversation.");
  }
}

async function postMessage(conversationId: number, message: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Could not send message.");
}

function statusLabel(status: PromptStatus): string {
  return status === "succeeded" ? "Complete" : status[0].toUpperCase() + status.slice(1);
}
