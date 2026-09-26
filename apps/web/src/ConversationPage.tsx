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
  system?: string;
}

interface ConversationResponse {
  conversation: ConversationTurn;
  messages: ConversationTurn[];
}

/** Shows a persisted model conversation and permits the next user turn.
 * Example: `<ConversationPage conversationId={12} />`.
 */
export function ConversationPage({
  conversationId, onRetry, onSelectConversation,
}: {
  conversationId: number;
  onRetry: (id: number) => Promise<void>;
  onSelectConversation: (id: number) => void;
}) {
  const [conversation, setConversation] = useState<ConversationResponse>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>();
  const [isSending, setIsSending] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [editingTurnId, setEditingTurnId] = useState<number>();
  const [editedPrompt, setEditedPrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);

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

  async function retryFailedConversation(): Promise<void> {
    setIsRetrying(true);
    setError(undefined);
    try {
      await onRetry(conversationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not retry conversation.");
    } finally {
      setIsRetrying(false);
    }
  }

  async function savePromptEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editingTurnId === undefined || !editedPrompt.trim()) return;
    setIsEditing(true);
    setError(undefined);
    try {
      const editedConversationId = editingTurnId;
      await editPrompt(editedConversationId, editedPrompt);
      setEditingTurnId(undefined);
      if (editedConversationId === conversationId)
        await loadConversation(conversationId, setConversation, setError);
      else onSelectConversation(editedConversationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not edit message.");
    } finally {
      setIsEditing(false);
    }
  }

  if (!conversation)
    return <section className="conversation">
      <p className="muted">Loading conversation…</p>
    </section>;
  return <ConversationContents
    conversation={conversation}
    message={message}
    editedPrompt={editedPrompt}
    isSending={isSending}
    isRetrying={isRetrying}
    editingTurnId={editingTurnId}
    isEditing={isEditing}
    error={error}
    onMessageChange={setMessage}
    onSend={sendMessage}
    onRetry={retryFailedConversation}
    onCancelEdit={() => setEditingTurnId(undefined)}
    onEdit={(turn) => { setEditingTurnId(turn.id); setEditedPrompt(turn.prompt); }}
    onPromptChange={setEditedPrompt}
    onSaveEdit={savePromptEdit}
  />;
}

interface ConversationContentsProps {
  conversation: ConversationResponse;
  message: string;
  editedPrompt: string;
  isSending: boolean;
  isRetrying: boolean;
  editingTurnId: number | undefined;
  isEditing: boolean;
  error: string | undefined;
  onMessageChange: (message: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRetry: () => Promise<void>;
  onCancelEdit: () => void;
  onEdit: (turn: ConversationTurn) => void;
  onPromptChange: (prompt: string) => void;
  onSaveEdit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

function ConversationContents(props: ConversationContentsProps) {
  const latest = props.conversation.conversation;
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
        {props.conversation.messages.map((turn) => (
          <ConversationTurnView
            turn={turn}
            key={turn.id}
            editedPrompt={props.editedPrompt}
            isEditing={props.editingTurnId === turn.id}
            isSaving={props.isEditing}
            onCancel={props.onCancelEdit}
            onEdit={() => props.onEdit(turn)}
            onPromptChange={props.onPromptChange}
            onSave={props.onSaveEdit}
          />
        ))}
      </div>
      {latest.status === "succeeded" && (
        <form className="composer" onSubmit={(event) => void props.onSend(event)}>
          <label>
            Continue the conversation
            <textarea
              value={props.message}
              onChange={(event) => props.onMessageChange(event.target.value)}
              rows={3}
              required
            />
          </label>
          <div className="composer-footer">
            <span>Your message will join the end of the current queue.</span>
            <button type="submit" disabled={props.isSending}>
              {props.isSending ? "Queued…" : "Send"} <span>↑</span>
            </button>
          </div>
        </form>
      )}
      {latest.status === "failed" && (
        <button type="button" onClick={() => void props.onRetry()} disabled={props.isRetrying}>
          {props.isRetrying ? "Retrying…" : "Retry"}
        </button>
      )}
      {props.error && <div className="notice error">{props.error}</div>}
    </section>
  );
}

function ConversationTurnView({
  turn, editedPrompt, isEditing, isSaving, onCancel, onEdit, onPromptChange, onSave,
}: {
  turn: ConversationTurn;
  editedPrompt: string;
  isEditing: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onEdit: () => void;
  onPromptChange: (prompt: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return <>
    {turn.system && <article className="message system-message">
      <strong>System</strong><p>{turn.system}</p>
    </article>}
    <article className="message user-message">
      <div className="message-heading">
        <strong>You</strong>
        {!isEditing && (turn.status === "succeeded" || turn.status === "failed") && (
          <button type="button" className="edit-prompt" onClick={onEdit} disabled={isSaving}>
            Edit
          </button>
        )}
      </div>
      {isEditing ? <form className="prompt-edit-form" onSubmit={(event) => void onSave(event)}>
        <textarea value={editedPrompt} onChange={(event) => onPromptChange(event.target.value)}
          rows={3} required autoFocus />
        <p>Later messages and their responses will be removed.</p>
        <div><button type="button" onClick={onCancel} disabled={isSaving}>Cancel</button>
          <button type="submit" disabled={isSaving}>
            {isSaving ? "Regenerating…" : "Save & regenerate"}
          </button>
        </div>
      </form> : <p>{turn.prompt}</p>}
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

async function editPrompt(conversationId: number, prompt: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Could not edit message.");
}

function statusLabel(status: PromptStatus): string {
  return status === "succeeded" ? "Complete" : status[0].toUpperCase() + status.slice(1);
}
