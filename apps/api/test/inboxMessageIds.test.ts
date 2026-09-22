import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listUnclassifiedInboxMessageIds } from '@jojo-claw/email-assistant/inboxMessageIds'

class GmailInboxFake {
  readonly requestedPageTokens: Array<string | null> = []

  async fetch(input: string | URL | Request): Promise<Response> {
    const inboxUrl = new URL(String(input))
    const pageToken = inboxUrl.searchParams.get('pageToken')
    this.requestedPageTokens.push(pageToken)
    return Response.json(pageToken ? { messages: [{ id: 'eleven' }] } : {
      messages: [{ id: 'saved' }, ...Array.from({ length: 9 }, (_, index) => ({ id: String(index + 1) }))],
      nextPageToken: 'second-page',
    })
  }
}

describe('listUnclassifiedInboxMessageIds', () => {
  it('continues Gmail pages to return ten unseen messages', async () => {
    const gmailInbox = new GmailInboxFake()
    const messageIds = await listUnclassifiedInboxMessageIds({
      request: gmailInbox.fetch.bind(gmailInbox) as typeof fetch,
      token: 'token', gmailApiBaseUrl: 'https://gmail.example/v1/users/me',
      knownMessageIds: new Set(['saved']), maximumMessages: 10,
    })
    assert.deepEqual(messageIds, ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'eleven'])
    assert.deepEqual(gmailInbox.requestedPageTokens, [null, 'second-page'])
  })
})
