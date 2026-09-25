export interface EmailEvaluation {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  description: string;
  category?: string;
  suggestedCategory?: string;
  categoryStatus?:
    | "processing" | "suggested-new" | "suggested-existing" | "confirmed" | "failed";
  categoryError?: string;
  suggestedActions?: string[];
  actionAppliedAt?: string;
  categoryPromptProposal?: string;
}

/** Displays one evaluated email and its available category and Gmail actions.
 * Example: `<EmailEvaluationCard email={email} confirming={false} applying={false}
 * retrying={false} onConfirm={save} onApply={apply} onRetry={retry} />`.
 */
export function EmailEvaluationCard(props: {
  email: EmailEvaluation;
  confirming: boolean;
  applying: boolean;
  retrying: boolean;
  onConfirm(email: EmailEvaluation): void;
  onApply(email: EmailEvaluation): void;
  onRetry(email: EmailEvaluation): void;
}) {
  const { email } = props;
  return <article className="email-evaluation">
    <div className="email-evaluation-heading">
      <div>
        <strong>{email.from || "Unknown sender"}</strong>
        <time dateTime={email.receivedAt}>{formatDate(email.receivedAt)}</time>
      </div>
      <CategoryIndicator {...props} />
    </div>
    <h3>{email.subject || "No subject"}</h3>
    <p>{email.description}</p>
    <RetryClassification {...props} />
    <SuggestedActions {...props} />
    <PromptProposal email={email} />
  </article>;
}

function RetryClassification(props: {
  email: EmailEvaluation;
  retrying: boolean;
  onRetry(email: EmailEvaluation): void;
}) {
  if (props.email.categoryStatus === "processing") return null;
  return <button className="email-category suggested" disabled={props.retrying}
    onClick={() => props.onRetry(props.email)} type="button">
    {props.retrying ? "Retrying classification…" : "Retry classification"}
  </button>;
}

function CategoryIndicator(props: {
  email: EmailEvaluation;
  confirming: boolean;
  onConfirm(email: EmailEvaluation): void;
}) {
  const { email } = props;
  if (email.categoryStatus === "processing")
    return <span className="email-category processing">In processing</span>;
  if (email.categoryStatus === "failed")
    return <span className="email-category failed" title={email.categoryError}>
      Category evaluation failed
    </span>;
  if (!email.suggestedCategory)
    return <span className="email-category">{email.category ?? "Uncategorized"}</span>;
  const verb = email.categoryStatus === "suggested-new" ? "Create" : "Confirm existing";
  return <button className="email-category suggested" disabled={props.confirming}
    onClick={() => props.onConfirm(email)} type="button">
    {props.confirming
      ? `${verb === "Create" ? "Creating" : "Confirming"}…`
      : `${verb} “${email.suggestedCategory}”`}
  </button>;
}

function SuggestedActions(props: {
  email: EmailEvaluation;
  applying: boolean;
  onApply(email: EmailEvaluation): void;
}) {
  const { email } = props;
  if (!email.suggestedActions?.length) return null;
  return <p className="email-action">
    {email.actionAppliedAt ? "Actions applied: " : "Suggested actions: "}
    {email.suggestedActions.map(formatAction).join(" + ")}
    {!email.actionAppliedAt && <button className="email-category suggested"
      disabled={props.applying} onClick={() => props.onApply(email)} type="button">
      {props.applying ? "Applying…" : "Apply actions"}
    </button>}
  </p>;
}
function PromptProposal({ email }: { email: EmailEvaluation }) {
  if (!email.categoryPromptProposal) return null;
  return <section className="email-prompt-proposal">
    <strong>Proposed Email category instructions</strong>
    <pre>{email.categoryPromptProposal}</pre>
  </section>;
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatAction(value: string): string {
  if (value === "mark-read") return "Mark as read";
  if (value === "star") return "Star";
  if (value === "trash") return "Move to trash";
  return value.startsWith("archive:")
    ? `Archive in ${value.slice("archive:".length)}`
    : value;
}
