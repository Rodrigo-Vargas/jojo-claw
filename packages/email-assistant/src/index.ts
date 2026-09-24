import type { PlatformPlugin } from "@jojo-claw/core";
import { EmailAssistantRepository } from "./EmailAssistantRepository.js";
import { emailAssistantPluginManifest } from "./manifest.js";
import { registerEmailAssistantRoutes } from "./register-email-assistant-routes.js";
import { GoogleConnectionService } from "./services/GoogleConnectionService.js";

export type { EmailEvaluation } from "./email-types.js";
export interface EmailAssistantOptions {
  fetch?: typeof fetch;
  oauth?: { clientId?: string; clientSecret?: string; redirectUri?: string };
}

/** Creates the local Gmail OAuth and Inbox-evaluation plugin.
 * Example: `createEmailAssistantPlugin({ fetch: gmailFetch })`.
 */
export function createEmailAssistantPlugin(options: EmailAssistantOptions = {}): PlatformPlugin {
  const request = options.fetch ?? fetch;
  return {
    manifest: emailAssistantPluginManifest,
    register(context) {
      const repository = new EmailAssistantRepository(context.storage);
      registerEmailSettings(context);
      registerEmailSecrets(context);
      registerEmailPrompts(context);
      const service = googleConnectionService(context, request, options, repository);
      registerEmailAssistantRoutes({ context, request, repository, service });
    },
  };
}

function registerEmailSettings(context: Parameters<PlatformPlugin["register"]>[0]): void {
  const categoryActionsDescription = [
    "Map a category to one or more actions: mark-read, star, trash,",
    "or archive:<Gmail label name>.",
  ].join(" ");
  context.registerSetting({
    id: "categories",
    name: "Email categories",
    type: "string-list",
    defaultValue: [],
    description: "Categories for inbox classification, one per line.",
    migrateLegacyValue: migrateEmailCategories,
  });
  context.registerSetting({
    id: "category-actions",
    name: "Category actions",
    type: "list",
    defaultValue: [],
    description: categoryActionsDescription,
  });
}

function migrateEmailCategories(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap(legacyCategoryName);
}

function legacyCategoryName(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!value || typeof value !== "object") return [];
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? [name.trim()] : [];
}

function registerEmailSecrets(context: Parameters<PlatformPlugin["register"]>[0]): void {
  context.registerSecret({
    id: "google-client-id",
    name: "Google OAuth client ID",
    description: "OAuth client ID configured in Google Cloud for Email assistant.",
  });
  context.registerSecret({
    id: "google-client-secret",
    name: "Google OAuth client secret",
    description: "Optional client secret when the selected Google OAuth client requires one.",
  });
}

function registerEmailPrompts(context: Parameters<PlatformPlugin["register"]>[0]): void {
  context.definePrompt({
    id: "email-summary-system",
    name: "Email summary instructions",
    kind: "system",
    defaultContent: "Summarize emails accurately and concisely.",
  });
  context.definePrompt({
    id: "email-summary",
    name: "Email summary template",
    kind: "prompt",
    defaultContent: "From: {{from}}\nSubject: {{subject}}\nReceived: {{receivedAt}}\n\n{{body}}",
  });
  context.definePrompt({
    id: "email-category-system",
    name: "Email category instructions",
    kind: "system",
    defaultContent: "Choose the best category using one provided tool call.",
  });
  context.definePrompt({
    id: "email-category",
    name: "Email category template",
    kind: "prompt",
    defaultContent: "Categories:\n{{categories}}\n\nEmail:\n{{email}}",
  });
}

function googleConnectionService(
  context: Parameters<PlatformPlugin["register"]>[0],
  request: typeof fetch,
  options: EmailAssistantOptions,
  repository: EmailAssistantRepository,
): GoogleConnectionService {
  return new GoogleConnectionService({
    fetch: request,
    repository,
    configuration: () => ({
      clientId: options.oauth?.clientId ?? context.getSecret("google-client-id") ?? "",
      clientSecret: options.oauth?.clientSecret ?? context.getSecret("google-client-secret") ?? "",
      redirectUri: options.oauth?.redirectUri
        ?? process.env.JOJO_GOOGLE_REDIRECT_URI
        ?? "http://localhost:8788/api/plugins/email-assistant/oauth/callback",
    }),
  });
}
