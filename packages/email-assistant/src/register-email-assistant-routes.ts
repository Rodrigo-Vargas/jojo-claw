import { pluginRedirect } from "@jojo-claw/core";
import { EmailAssistantRepository } from "./EmailAssistantRepository.js";
import { CategoryEvaluationQueue } from "./category-evaluation-queue.js";
import { proposeCategoryPromptChange } from "./category-prompt-proposal.js";
import {
  actionsForCategory,
  categoryActions,
  emailCategories,
  matchingCategory,
  withMappedActions,
} from "./category-settings.js";
import { applyGmailActions, listGmailLabels } from "./gmail-client.js";
import { evaluateInbox, retryCategoryEvaluation } from "./inbox-evaluator.js";
import type { EmailAssistantContext } from "./email-types.js";
import { GoogleConnectionService } from "./services/GoogleConnectionService.js";

export function registerEmailAssistantRoutes(input: {
  context: EmailAssistantContext;
  request: typeof fetch;
  repository: EmailAssistantRepository;
  service: GoogleConnectionService;
}): void {
  const { context, request, repository, service } = input;
  const categoryQueue = new CategoryEvaluationQueue();
  registerConnectionRoutes(context, request, service);
  registerEvaluationRoutes({ context, request, repository, service, categoryQueue });
}

function registerConnectionRoutes(
  context: EmailAssistantContext,
  request: typeof fetch,
  service: GoogleConnectionService,
): void {
  context.registerRoute({
    method: "GET",
    path: "/status",
    async handle() { return service.status(); },
  });
  context.registerRoute({
    method: "GET",
    path: "/labels",
    async handle() { return listGmailLabels(request, await service.accessToken()); },
  });
  context.registerRoute({
    method: "GET",
    path: "/connect",
    async handle() { return pluginRedirect(service.authorizationUrl()); },
  });
  context.registerRoute({
    method: "GET",
    path: "/oauth/callback",
    async handle({ query }) {
      await service.completeAuthorization(query);
      const connectionUrl = process.env.JOJO_WEB_URL ?? "http://localhost:5173";
      return pluginRedirect(`${connectionUrl}/plugins/email-assistant?gmail=connected`);
    },
  });
  context.registerRoute({
    method: "POST",
    path: "/disconnect",
    async handle() { return service.disconnect(); },
  });
}

function registerEvaluationRoutes(input: {
  context: EmailAssistantContext;
  request: typeof fetch;
  repository: EmailAssistantRepository;
  service: GoogleConnectionService;
  categoryQueue: CategoryEvaluationQueue;
}): void {
  const { context, request, repository, service, categoryQueue } = input;
  context.registerRoute({
    method: "GET",
    path: "/evaluations",
    async handle() {
      const actions = categoryActions(context.getSetting("category-actions"));
      return repository.listEvaluations()
        .map((evaluation) => withMappedActions(evaluation, actions));
    },
  });
  context.registerRoute({
    method: "POST",
    path: "/confirm-category",
    async handle({ body }) { return confirmCategory(context, repository, body); },
  });
  context.registerRoute({
    method: "POST",
    path: "/evaluate-inbox",
    async handle() {
      return evaluateInbox({ context, request, repository, service, categoryQueue });
    },
  });
  context.registerRoute({
    method: "POST",
    path: "/retry-classification",
    async handle({ body }) {
      if (!isRetryClassificationInput(body))
        throw new Error("messageId must be a non-empty string.");
      return retryCategoryEvaluation(
        { context, request, repository, service, categoryQueue }, body.messageId,
      );
    },
  });
  context.registerRoute({
    method: "POST",
    path: "/delete-evaluation",
    async handle({ body }) {
      if (!isDeleteEvaluationInput(body))
        throw new Error("messageId must be a non-empty string.");
      repository.deleteEvaluation(body.messageId);
      return { messageId: body.messageId };
    },
  });
  context.registerRoute({
    method: "POST",
    path: "/apply-action",
    async handle({ body }) {
      return applyCategoryActions({ context, request, repository, service, body });
    },
  });
}

async function confirmCategory(
  context: EmailAssistantContext, repository: EmailAssistantRepository, body: unknown,
): Promise<{ category: string; suggestedActions?: string[]; promptProposal?: string }> {
  if (!isConfirmCategoryInput(body)) throw new Error("category must be a string.");
  const name = body.category.trim();
  if (!name) throw new Error("category must not be empty.");
  const categories = emailCategories(context.getSetting("categories"));
  const existing = matchingCategory(name, categories);
  if (!existing) context.setSetting("categories", [...categories, name]);
  const category = existing ?? name;
  const actions = categoryActions(context.getSetting("category-actions"));
  const suggestedActions = actionsForCategory(category, actions);
  const email = body.messageId ? repository.getEvaluation(body.messageId) : undefined;
  const promptProposal = !existing && email
    ? await proposeCategoryPromptChange(context, category, email)
    : undefined;
  if (body.messageId) {
    repository.confirmEvaluationCategory(
      body.messageId, category, suggestedActions, promptProposal,
    );
  }
  const result = suggestedActions.length ? { category, suggestedActions } : { category };
  return promptProposal ? { ...result, promptProposal } : result;
}

async function applyCategoryActions(input: {
  context: EmailAssistantContext;
  request: typeof fetch;
  repository: EmailAssistantRepository;
  service: GoogleConnectionService;
  body: unknown;
}): Promise<{ actions: string[]; appliedAt: string }> {
  const { context, request, repository, service, body } = input;
  if (!isActionInput(body)) throw new Error("messageId must be a string.");
  const email = repository.listEvaluations()
    .find((item) => item.messageId === body.messageId);
  if (!email?.category) {
    throw new Error(`Email "${body.messageId}" has no confirmed category.`);
  }
  if (email.actionAppliedAt) {
    throw new Error(`Email "${body.messageId}" already has an applied action.`);
  }
  const configuredActions = categoryActions(context.getSetting("category-actions"));
  const actions = actionsForCategory(email.category, configuredActions);
  if (!actions.length) throw new Error(`Category "${email.category}" has no configured actions.`);
  await applyGmailActions(request, await service.accessToken(), body.messageId, actions);
  const appliedAt = new Date().toISOString();
  repository.markEvaluationActionApplied(body.messageId, appliedAt);
  return { actions, appliedAt };
}

function isConfirmCategoryInput(
  value: unknown,
): value is { category: string; messageId?: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { category?: unknown; messageId?: unknown };
  return typeof candidate.category === "string"
    && (candidate.messageId === undefined || typeof candidate.messageId === "string");
}

function isActionInput(value: unknown): value is { messageId: string } {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { messageId?: unknown }).messageId === "string";
}

function isRetryClassificationInput(value: unknown): value is { messageId: string } {
  return isActionInput(value) && value.messageId.trim().length > 0;
}

function isDeleteEvaluationInput(value: unknown): value is { messageId: string } {
  return isRetryClassificationInput(value);
}
