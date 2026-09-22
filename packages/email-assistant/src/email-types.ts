import type { EmailAssistantEvaluation, PlatformPlugin } from "@jojo-claw/core";

export type EmailEvaluation = EmailAssistantEvaluation;
export type EmailAssistantContext = Parameters<PlatformPlugin["register"]>[0];
export type EmailCategory = { name: string; action: string };
export type CategoryAction = { category: string; actions: string[] };
export interface GmailEmail {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
}

