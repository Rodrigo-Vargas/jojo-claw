/* eslint-disable max-len, max-params -- Gmail wire helpers share request context. */
import type { GmailEmail } from "./email-types.js";

export const gmailApiBaseUrl = "https://gmail.googleapis.com/gmail/v1/users/me";
const maxEmailCharacters = 6_000;

export async function listGmailLabels(
  request: typeof fetch,
  token: string,
): Promise<Array<{ id: string; name: string }>> {
  const response = await request(`${gmailApiBaseUrl}/labels`, { headers: gmailHeaders(token) });
  const payload = await readGmailJson<{ labels?: GmailLabel[] }>(response);
  return (payload.labels ?? []).flatMap((label) =>
    label.id && label.name && label.type === "user" ? [{ id: label.id, name: label.name }] : [],
  );
}

interface GmailLabel { id?: string; name?: string; type?: string }

export async function readEmail(
  request: typeof fetch,
  token: string,
  messageId: string,
): Promise<GmailEmail> {
  const response = await request(
    `${gmailApiBaseUrl}/messages/${encodeURIComponent(messageId)}?format=full`,
    { headers: gmailHeaders(token) },
  );
  const message = await readGmailJson<GmailMessage>(response);
  return gmailEmailFromMessage(message, messageId);
}

function gmailEmailFromMessage(message: GmailMessage, fallbackId: string): GmailEmail {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) => headers.find((entry) =>
    entry.name?.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";
  return {
    messageId: message.id ?? fallbackId, from: header("From"), subject: header("Subject"),
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : "",
    body: truncate(extractBody(message.payload) || message.snippet || "", maxEmailCharacters),
  };
}

export async function applyGmailActions(
  request: typeof fetch,
  token: string,
  messageId: string,
  actions: string[],
): Promise<void> {
  const modifyBody = await gmailModifyBody(request, token, actions);
  if (modifyBody) await postGmailAction(request, token, messageId, "modify", modifyBody);
  if (actions.includes("trash")) await postGmailAction(request, token, messageId, "trash");
}

async function gmailModifyBody(
  request: typeof fetch,
  token: string,
  actions: string[],
): Promise<Record<string, string[]> | undefined> {
  const addLabelIds = actions.includes("star") ? ["STARRED"] : [];
  const removeLabelIds = actions.includes("mark-read") ? ["UNREAD"] : [];
  const archives = actions.filter((action) => action.startsWith("archive:"));
  if (archives.length) await addArchiveLabels(request, token, archives, addLabelIds, removeLabelIds);
  return addLabelIds.length || removeLabelIds.length ? { addLabelIds, removeLabelIds } : undefined;
}

async function addArchiveLabels(
  request: typeof fetch, token: string, archives: string[], addLabelIds: string[], removeLabelIds: string[],
): Promise<void> {
  const labels = await listGmailLabels(request, token);
  for (const archive of archives) {
    const labelName = archive.slice("archive:".length);
    const label = labels.find((item) => item.name === labelName);
    if (!label) throw new Error(`Gmail label "${labelName}" no longer exists.`);
    addLabelIds.push(label.id);
  }
  removeLabelIds.push("INBOX");
}

async function postGmailAction(
  request: typeof fetch, token: string, messageId: string, operation: "modify" | "trash", body?: Record<string, string[]>,
): Promise<void> {
  const response = await request(`${gmailApiBaseUrl}/messages/${encodeURIComponent(messageId)}/${operation}`, {
    method: "POST", headers: { ...gmailHeaders(token), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  await readGmailJson<unknown>(response);
}

function gmailHeaders(token: string): HeadersInit { return { authorization: `Bearer ${token}` }; }

async function readGmailJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Gmail returned HTTP ${response.status}.`);
  return payload;
}

interface GmailMessagePart { mimeType?: string; body?: { data?: string }; parts?: GmailMessagePart[] }
interface GmailMessage {
  id?: string; internalDate?: string; snippet?: string;
  payload?: GmailMessagePart & { headers?: Array<{ name?: string; value?: string }> };
}

function extractBody(part: GmailMessagePart | undefined): string {
  if (!part) return "";
  const nested = part.parts?.map(extractBody).find(Boolean) ?? "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  if (part.mimeType === "text/html" && part.body?.data) return stripHtml(decodeBase64Url(part.body.data));
  return nested;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripHtml(value: string): string { return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function truncate(value: string, limit: number): string { return value.length > limit ? `${value.slice(0, limit)}…` : value; }
