/* eslint-disable max-len -- Route declarations retain HTTP behavior at a glance. */
import { pluginRedirect } from "@jojo-claw/core";
import { CategoryEvaluationQueue } from "./category-evaluation-queue.js";
import { actionsForCategory, categoryActions, emailCategories, matchingCategory, withMappedActions } from "./category-settings.js";
import { applyGmailActions, listGmailLabels } from "./gmail-client.js";
import { evaluateInbox } from "./inbox-evaluator.js";
import type { EmailAssistantContext } from "./email-types.js";
import { GoogleConnectionService } from "./services/GoogleConnectionService.js";

export function registerEmailAssistantRoutes(input: { context: EmailAssistantContext; request: typeof fetch; service: GoogleConnectionService }): void {
  const { context, request, service } = input;
  const categoryQueue = new CategoryEvaluationQueue();
  registerConnectionRoutes(context, request, service);
  registerEvaluationRoutes(context, request, service, categoryQueue);
}

function registerConnectionRoutes(context: EmailAssistantContext, request: typeof fetch, service: GoogleConnectionService): void {
  context.registerRoute({ method: "GET", path: "/status", async handle() { return service.status(); } });
  context.registerRoute({ method: "GET", path: "/labels", async handle() { return listGmailLabels(request, await service.accessToken()); } });
  context.registerRoute({ method: "GET", path: "/connect", async handle() { return pluginRedirect(service.authorizationUrl()); } });
  context.registerRoute({ method: "GET", path: "/oauth/callback", async handle({ query }) {
    await service.completeAuthorization(query);
    return pluginRedirect(`${process.env.JOJO_WEB_URL ?? "http://localhost:5173"}/plugins/email-assistant?gmail=connected`);
  } });
  context.registerRoute({ method: "POST", path: "/disconnect", async handle() { return service.disconnect(); } });
}

function registerEvaluationRoutes(context: EmailAssistantContext, request: typeof fetch, service: GoogleConnectionService, categoryQueue: CategoryEvaluationQueue): void {
  context.registerRoute({ method: "GET", path: "/evaluations", async handle() {
    const actions = categoryActions(context.getSetting("category-actions"));
    return context.database.emailAssistant.listEvaluations().map((evaluation) => withMappedActions(evaluation, actions));
  } });
  context.registerRoute({ method: "POST", path: "/confirm-category", async handle({ body }) { return confirmCategory(context, body); } });
  context.registerRoute({ method: "POST", path: "/evaluate-inbox", async handle() { return evaluateInbox({ context, request, service, categoryQueue }); } });
  context.registerRoute({ method: "POST", path: "/apply-action", async handle({ body }) { return applyCategoryActions(context, request, service, body); } });
}

function confirmCategory(context: EmailAssistantContext, body: unknown): { category: string; suggestedActions?: string[] } {
  if (!isConfirmCategoryInput(body)) throw new Error("category must be a string.");
  const name = body.category.trim();
  if (!name) throw new Error("category must not be empty.");
  const categories = emailCategories(context.getSetting("categories"));
  const existing = matchingCategory(name, categories);
  if (!existing) context.setSetting("categories", [...categories, { name, action: "" }]);
  const category = existing?.name ?? name;
  const suggestedActions = actionsForCategory(category, categoryActions(context.getSetting("category-actions")));
  if (body.messageId) context.database.emailAssistant.confirmEvaluationCategory(body.messageId, category, suggestedActions);
  return suggestedActions.length ? { category, suggestedActions } : { category };
}

async function applyCategoryActions(context: EmailAssistantContext, request: typeof fetch, service: GoogleConnectionService, body: unknown): Promise<{ actions: string[]; appliedAt: string }> {
  if (!isActionInput(body)) throw new Error("messageId must be a string.");
  const email = context.database.emailAssistant.listEvaluations().find((item) => item.messageId === body.messageId);
  if (!email?.category) throw new Error(`Email "${body.messageId}" has no confirmed category.`);
  if (email.actionAppliedAt) throw new Error(`Email "${body.messageId}" already has an applied action.`);
  const actions = actionsForCategory(email.category, categoryActions(context.getSetting("category-actions")));
  if (!actions.length) throw new Error(`Category "${email.category}" has no configured actions.`);
  await applyGmailActions(request, await service.accessToken(), body.messageId, actions);
  const appliedAt = new Date().toISOString();
  context.database.emailAssistant.markEvaluationActionApplied(body.messageId, appliedAt);
  return { actions, appliedAt };
}

function isConfirmCategoryInput(value: unknown): value is { category: string; messageId?: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { category?: unknown }).category === "string" && ((value as { messageId?: unknown }).messageId === undefined || typeof (value as { messageId?: unknown }).messageId === "string");
}

function isActionInput(value: unknown): value is { messageId: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { messageId?: unknown }).messageId === "string";
}
