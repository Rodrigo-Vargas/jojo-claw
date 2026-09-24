import type { PluginStorage } from "@jojo-claw/core";
import type {
  EmailAssistantConnection,
  EmailAssistantOAuthTransaction,
  EmailEvaluation,
} from "./email-types.js";

const connectionKey = "connection";
const evaluationPrefix = "evaluation:";
const transactionPrefix = "oauth:";

export class EmailAssistantRepository {
  constructor(private readonly storage: PluginStorage) {}

  getConnection(): EmailAssistantConnection | undefined {
    return this.storage.get<EmailAssistantConnection>(connectionKey);
  }

  saveConnection(connection: EmailAssistantConnection): void {
    this.storage.set(connectionKey, connection);
  }

  deleteConnection(): void {
    this.storage.delete(connectionKey);
  }

  deleteExpiredOAuthTransactions(before: number): void {
    for (const entry of this.transactions())
      if (entry.value.createdAt < before) this.storage.delete(entry.key);
  }

  createOAuthTransaction(state: string, transaction: EmailAssistantOAuthTransaction): void {
    this.storage.set(transactionKey(state), transaction);
  }

  consumeOAuthTransaction(state: string): EmailAssistantOAuthTransaction | undefined {
    const key = transactionKey(state);
    const transaction = this.storage.get<EmailAssistantOAuthTransaction>(key);
    this.storage.delete(key);
    return transaction;
  }

  listEvaluations(): EmailEvaluation[] {
    return this.storage.entries<EmailEvaluation>()
      .filter((entry) => entry.key.startsWith(evaluationPrefix))
      .map((entry) => entry.value)
      .sort(compareEvaluations);
  }
  getEvaluation(messageId: string): EmailEvaluation | undefined {
    return this.storage.get<EmailEvaluation>(evaluationKey(messageId));
  }


  saveEvaluation(evaluation: EmailEvaluation): void {
    this.storage.set(evaluationKey(evaluation.messageId), evaluation);
  }

  confirmEvaluationCategory(
    messageId: string,
    category: string,
    suggestedActions?: string[],
    categoryPromptProposal?: string,
  ): void {
    this.updateEvaluation(messageId, (evaluation) => ({
      ...evaluation, category, suggestedActions, suggestedCategory: undefined,
      categoryStatus: "confirmed", categoryError: undefined, categoryPromptProposal,
    }));
  }

  saveCategorySuggestion(
    messageId: string, category: string, status: "suggested-new" | "suggested-existing",
  ): void {
    this.updateEvaluation(messageId, (evaluation) => ({
      ...evaluation, category: undefined, suggestedCategory: category,
      categoryStatus: status, categoryError: undefined,
    }));
  }

  failCategoryEvaluation(messageId: string, error: string): void {
    this.updateEvaluation(messageId, (evaluation) => ({
      ...evaluation, categoryStatus: "failed", categoryError: error,
    }));
  }

  markEvaluationActionApplied(messageId: string, appliedAt: string): void {
    this.updateEvaluation(messageId, (evaluation) => ({
      ...evaluation, actionAppliedAt: appliedAt,
    }));
  }

  private transactions(): Array<{ key: string; value: EmailAssistantOAuthTransaction }> {
    return this.storage.entries<EmailAssistantOAuthTransaction>()
      .filter((entry) => entry.key.startsWith(transactionPrefix));
  }

  private updateEvaluation(
    messageId: string, update: (evaluation: EmailEvaluation) => EmailEvaluation,
  ): void {
    const existing = this.storage.get<EmailEvaluation>(evaluationKey(messageId));
    if (existing) this.saveEvaluation(update(existing));
  }
}

function transactionKey(state: string): string {
  return `${transactionPrefix}${state}`;
}

function evaluationKey(messageId: string): string {
  return `${evaluationPrefix}${messageId}`;
}

function compareEvaluations(left: EmailEvaluation, right: EmailEvaluation): number {
  return left.receivedAt.localeCompare(right.receivedAt)
    || left.messageId.localeCompare(right.messageId);
}
