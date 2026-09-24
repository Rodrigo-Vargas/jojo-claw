import type { PlatformPlugin } from "@jojo-claw/core";

export interface EmailAssistantConnection {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  grantedScopes: string;
  email: string | null;
}

export interface EmailAssistantOAuthTransaction {
  codeVerifier: string;
  createdAt: number;
}

export interface EmailEvaluation {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  description: string;
  category?: string;
  suggestedCategory?: string;
  categoryStatus: "processing" | "suggested-new" | "suggested-existing" | "confirmed" | "failed";
  categoryError?: string;
  suggestedActions?: string[];
  actionAppliedAt?: string;
}

export type EmailAssistantContext = Parameters<PlatformPlugin["register"]>[0];
export type CategoryAction = { category: string; actions: string[] };
export interface GmailEmail {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
}
