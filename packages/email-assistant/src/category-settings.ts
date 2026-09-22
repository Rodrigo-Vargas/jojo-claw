/* eslint-disable max-len -- Category-setting parsing preserves its input shapes. */
import type { EmailEvaluation } from "./email-types.js";
import type { CategoryAction, EmailCategory } from "./email-types.js";

export function emailCategories(value: unknown): EmailCategory[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(categoryFromSetting);
}

function categoryFromSetting(category: unknown): EmailCategory[] {
  if (typeof category === "string" && category.trim())
    return [{ name: category.trim(), action: "" }];
  if (!category || typeof category !== "object") return [];
  const input = category as { name?: unknown; action?: unknown };
  if (typeof input.name !== "string" || !input.name.trim()) return [];
  return [{ name: input.name.trim(), action: typeof input.action === "string" ? input.action : "" }];
}

export function matchingCategory(
  value: string,
  categories: EmailCategory[],
): EmailCategory | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  return categories.find((category) => category.name.trim().toLocaleLowerCase() === normalized);
}

export function categoryActions(value: unknown): CategoryAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(categoryActionFromSetting);
}

function categoryActionFromSetting(item: unknown): CategoryAction[] {
  if (!item || typeof item !== "object") return [];
  const entry = item as { category?: unknown; action?: unknown; actions?: unknown };
  if (typeof entry.category !== "string" || !entry.category.trim()) return [];
  const actions = Array.isArray(entry.actions) ? entry.actions : [entry.action];
  if (!actions.every(isEmailAction)) return [];
  return [{ category: entry.category.trim(), actions: [...new Set(actions)] }];
}

function isEmailAction(value: unknown): value is string {
  return value === "mark-read" || value === "star" || value === "trash" ||
    (typeof value === "string" && value.startsWith("archive:"));
}

export function actionsForCategory(category: string, actions: CategoryAction[]): string[] {
  return actions.find((item) =>
    item.category.toLocaleLowerCase() === category.toLocaleLowerCase(),
  )?.actions ?? [];
}

/** Refreshes an evaluation's actions from current category settings.
 * Example: `withMappedActions(evaluation, categoryActions(setting))`.
 */
export function withMappedActions(
  evaluation: EmailEvaluation,
  actions: CategoryAction[],
): EmailEvaluation {
  if (!evaluation.category) return evaluation;
  const suggestedActions = actionsForCategory(evaluation.category, actions);
  return suggestedActions.length
    ? { ...evaluation, suggestedActions }
    : { ...evaluation, suggestedActions: undefined };
}
