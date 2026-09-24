import type { ToolCall, ToolDefinition } from "@jojo-claw/core";
import { EmailAssistantRepository } from "./EmailAssistantRepository.js";
import { listUnclassifiedInboxMessageIds } from "./inboxMessageIds.js";
import { gmailApiBaseUrl, readEmail } from "./gmail-client.js";
import { emailCategories, matchingCategory } from "./category-settings.js";
import type {
  EmailAssistantContext,
  EmailEvaluation,
  GmailEmail,
} from "./email-types.js";
import { CategoryEvaluationQueue } from "./category-evaluation-queue.js";
import { GoogleConnectionService } from "./services/GoogleConnectionService.js";

const maxInboxMessages = 10;

export async function evaluateInbox(input: {
  context: EmailAssistantContext;
  request: typeof fetch;
  repository: EmailAssistantRepository;
  service: GoogleConnectionService;
  categoryQueue: CategoryEvaluationQueue;
}): Promise<{ evaluations: EmailEvaluation[] }> {
  const token = await input.service.accessToken();
  const messageIds = await unclassifiedMessageIds(input.repository, input.request, token);
  const evaluations: EmailEvaluation[] = [];
  for (const messageId of messageIds) {
    evaluations.push(await evaluateEmail(input, token, messageId));
  }
  return { evaluations };
}

async function unclassifiedMessageIds(
  repository: EmailAssistantRepository,
  request: typeof fetch,
  token: string,
): Promise<string[]> {
  const knownMessageIds = new Set(
    repository.listEvaluations().map((email) => email.messageId),
  );
  return listUnclassifiedInboxMessageIds({
    request,
    token,
    gmailApiBaseUrl,
    knownMessageIds,
    maximumMessages: maxInboxMessages,
  });
}

async function evaluateEmail(
  input: {
    context: EmailAssistantContext;
    request: typeof fetch;
    repository: EmailAssistantRepository;
    categoryQueue: CategoryEvaluationQueue;
  },
  token: string,
  messageId: string,
): Promise<EmailEvaluation> {
  const email = await readEmail(input.request, token, messageId);
  const summary = await input.context.generateText({
    system: input.context.getPrompt("email-summary-system"),
    prompt: emailPrompt(input.context, email),
  });
  const evaluation = toEvaluation(email, summary.text);
  input.repository.saveEvaluation(evaluation);
  input.categoryQueue.add(() => evaluateCategory(input.context, input.repository, email));
  return evaluation;
}

function toEvaluation(email: GmailEmail, description: string): EmailEvaluation {
  return {
    messageId: email.messageId,
    from: email.from,
    subject: email.subject,
    receivedAt: email.receivedAt,
    description: description.trim(),
    categoryStatus: "processing",
  };
}

function emailPrompt(context: EmailAssistantContext, email: GmailEmail): string {
  return interpolatePrompt(context.getPrompt("email-summary"), email);
}

async function evaluateCategory(
  context: EmailAssistantContext,
  repository: EmailAssistantRepository,
  email: GmailEmail,
): Promise<void> {
  try {
    const categories = emailCategories(context.getSetting("categories"));
    const response = await context.generateWithTools({
      messages: categoryMessages(context, email, categories),
      tools: categoryTools,
    });

    saveToolCategorySuggestion(repository, email.messageId, response.toolCalls, categories);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "Category evaluation failed.";
    repository.failCategoryEvaluation(email.messageId, error);
  }
}

function categoryMessages(
  context: EmailAssistantContext,
  email: GmailEmail,
  categories: string[],
) {
  return [
    { role: "system" as const, content: context.getPrompt("email-category-system") },
    { role: "user" as const, content: categoryPrompt(context, email, categories) },
  ];
}

function categoryPrompt(
  context: EmailAssistantContext,
  email: GmailEmail,
  categories: string[],
): string {
  const list = categories.length
    ? categories.map((category) => `- ${category}`).join("\n")
    : "(No categories have been configured.)";
  return interpolateTemplate(context.getPrompt("email-category"), {
    categories: list,
    email: emailPrompt(context, email),
  });
}

function interpolatePrompt(template: string, email: GmailEmail): string {
  return interpolateTemplate(template, {
    from: email.from,
    subject: email.subject,
    receivedAt: email.receivedAt,
    body: email.body,
  });
}

function interpolateTemplate(template: string, values: Record<string, string>): string {
  return template.replace(
    /{{(from|subject|receivedAt|body|categories|email)}}/g,
    (_, key: string) => values[key] ?? "",
  );
}

const categoryParameterSchema = {
  type: "object" as const,
  properties: { category: { type: "string" as const } },
  required: ["category"],
  additionalProperties: false,
};
const categoryTools: ToolDefinition[] = [
  {
    name: "suggest_new_category",
    description: "Suggest a category only when no configured category fits.",
    parameters: categoryParameterSchema,
  },
  {
    name: "confirm_existing_category",
    description: "Suggest a category from the configured categories when one fits.",
    parameters: categoryParameterSchema,
  },
];

function saveToolCategorySuggestion(
  repository: EmailAssistantRepository,
  messageId: string,
  calls: ToolCall[],
  categories: string[],
): void {
  if (calls.length !== 1) {
    throw new Error(`Expected exactly one category tool call, received ${calls.length}.`);
  }
  const call = calls[0];
  const category = toolCategory(call);
  if (call.name === "suggest_new_category") {
    return saveNewSuggestion(repository, messageId, category, categories);
  }
  if (call.name === "confirm_existing_category") {
    return saveExistingSuggestion(repository, messageId, category, categories);
  }
  throw new Error(`Unknown category tool "${call.name}".`);
}

function saveNewSuggestion(
  repository: EmailAssistantRepository,
  messageId: string,
  category: string,
  categories: string[],
): void {
  if (matchingCategory(category, categories)) {
    throw new Error(`New category suggestion "${category}" already exists.`);
  }
  repository.saveCategorySuggestion(messageId, category, "suggested-new");
}

function saveExistingSuggestion(
  repository: EmailAssistantRepository,
  messageId: string,
  category: string,
  categories: string[],
): void {
  const existing = matchingCategory(category, categories);
  if (!existing) {
    throw new Error(`Existing category suggestion "${category}" is not configured.`);
  }
  repository.saveCategorySuggestion(messageId, existing, "suggested-existing");
}

function toolCategory(call: ToolCall): string {
  const value = call.arguments.category;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Tool "${call.name}" requires a non-empty category string.`);
  }
  return value.trim();
}
