/* eslint-disable max-len -- Plugin declarations retain their user-facing metadata. */
import type { PlatformPlugin } from "@jojo-claw/core";
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
      registerEmailSettings(context);
      registerEmailSecrets(context);
      registerEmailAssistantRoutes({ context, request, service: googleConnectionService(context, request, options) });
    },
  };
}

function registerEmailSettings(context: Parameters<PlatformPlugin["register"]>[0]): void {
  context.registerSetting({ id: "categories", name: "Email categories", type: "list", defaultValue: [],
    description: "Categories for inbox classification. Each item has a name and optional action." });
  context.registerSetting({ id: "category-actions", name: "Category actions", type: "list", defaultValue: [],
    description: "Map a category to one or more actions: mark-read, star, trash, or archive:<Gmail label name>." });
}

function registerEmailSecrets(context: Parameters<PlatformPlugin["register"]>[0]): void {
  context.registerSecret({ id: "google-client-id", name: "Google OAuth client ID", description: "OAuth client ID configured in Google Cloud for Email assistant." });
  context.registerSecret({ id: "google-client-secret", name: "Google OAuth client secret", description: "Optional client secret when the selected Google OAuth client requires one." });
}

function googleConnectionService(
  context: Parameters<PlatformPlugin["register"]>[0], request: typeof fetch, options: EmailAssistantOptions,
): GoogleConnectionService {
  return new GoogleConnectionService({ fetch: request, database: context.database, configuration: () => ({
    clientId: options.oauth?.clientId ?? context.getSecret("google-client-id") ?? "",
    clientSecret: options.oauth?.clientSecret ?? context.getSecret("google-client-secret") ?? "",
    redirectUri: options.oauth?.redirectUri ?? process.env.JOJO_GOOGLE_REDIRECT_URI ?? "http://localhost:8788/api/plugins/email-assistant/oauth/callback",
  }) });
}
