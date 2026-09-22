const inboxPageSize = 100;

export interface InboxMessageIdRequest {
  request: typeof fetch;
  token: string;
  gmailApiBaseUrl: string;
  knownMessageIds: ReadonlySet<string>;
  maximumMessages: number;
}

interface GmailInboxPage {
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
}

/** Lists unseen Inbox IDs, continuing through Gmail pages until its requested batch is full.
 * Example: `await listUnclassifiedInboxMessageIds({ maximumMessages: 10, ...request })`.
 */
export async function listUnclassifiedInboxMessageIds(
  input: InboxMessageIdRequest,
): Promise<string[]> {
  const unseenMessageIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const inboxPage = await readInboxPage(input, pageToken);
    addUnseenMessageIds(input, inboxPage.messages, unseenMessageIds);
    if (unseenMessageIds.length >= input.maximumMessages) break;
    pageToken = inboxPage.nextPageToken;
  } while (pageToken);
  return unseenMessageIds.slice(0, input.maximumMessages);
}

async function readInboxPage(
  input: InboxMessageIdRequest,
  pageToken: string | undefined,
): Promise<GmailInboxPage> {
  const inboxUrl = new URL(`${input.gmailApiBaseUrl}/messages`);
  inboxUrl.searchParams.set("labelIds", "INBOX");
  inboxUrl.searchParams.set("maxResults", String(inboxPageSize));
  if (pageToken) inboxUrl.searchParams.set("pageToken", pageToken);
  const response = await input.request(inboxUrl, {
    headers: { authorization: `Bearer ${input.token}` },
  });
  return readInboxPageJson(response);
}

async function readInboxPageJson(response: Response): Promise<GmailInboxPage> {
  const inboxPage = (await response.json()) as GmailInboxPage & {
    error?: { message?: string };
  };
  if (response.ok) return inboxPage;
  throw new Error(
    inboxPage.error?.message ??
      `Gmail Inbox page returned HTTP ${response.status}.`,
  );
}

function addUnseenMessageIds(
  input: InboxMessageIdRequest,
  messages: GmailInboxPage["messages"],
  unseenMessageIds: string[],
): void {
  for (const message of messages ?? []) {
    if (message.id && !input.knownMessageIds.has(message.id))
      unseenMessageIds.push(message.id);
    if (unseenMessageIds.length >= input.maximumMessages) return;
  }
}
