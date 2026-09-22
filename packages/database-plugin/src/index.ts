/* eslint-disable max-lines-per-function -- Database operations share one SQLite connection. */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DatabaseOperations,
  EmailAssistantConnection,
  EmailAssistantEvaluation,
  EmailAssistantOAuthTransaction,
  PlatformPlugin,
} from "@jojo-claw/core";
import { databasePluginManifest } from "./manifest.js";

export interface DatabasePluginOptions {
  storagePath?: string;
}

export interface ConfiguredDatabasePlugin {
  plugin: PlatformPlugin;
  operations: DatabaseOperations;
}

interface EmailAssistantConnectionRow {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  granted_scopes: string;
  email: string | null;
}

function initializeSchema(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS email_assistant_connection (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
      expiry_date INTEGER NOT NULL, granted_scopes TEXT NOT NULL, email TEXT
    );
    CREATE TABLE IF NOT EXISTS email_assistant_oauth_transaction (
      state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_assistant_evaluation (
      message_id TEXT PRIMARY KEY, sender TEXT NOT NULL, subject TEXT NOT NULL,
      received_at TEXT NOT NULL, description TEXT NOT NULL, category TEXT,
      suggested_category TEXT
    );
  `);
}

/** Configures SQLite and applies schema owned by the platform database plugin.
 * Example: `createDatabasePlugin({ storagePath: ':memory:' })`.
 */
export function createDatabasePlugin(
  options: DatabasePluginOptions = {},
): ConfiguredDatabasePlugin {
  const storagePath =
    options.storagePath ?? resolve(process.cwd(), ".jojo-claw", "database.db");
  if (storagePath !== ":memory:")
    mkdirSync(dirname(storagePath), { recursive: true });
  const connection = new DatabaseSync(storagePath);
  initializeSchema(connection);
  const operations: DatabaseOperations = {
    emailAssistant: {
      getConnection() {
        const row = connection
          .prepare(
            "SELECT access_token, refresh_token, expiry_date, granted_scopes, email " +
              "FROM email_assistant_connection WHERE id = 1",
          )
          .get() as EmailAssistantConnectionRow | undefined;
        return (
          row && {
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            expiryDate: row.expiry_date,
            grantedScopes: row.granted_scopes,
            email: row.email,
          }
        );
      },
      saveConnection(input: EmailAssistantConnection) {
        connection
          .prepare(
            `
          INSERT INTO email_assistant_connection (
            id, access_token, refresh_token, expiry_date, granted_scopes, email
          )
          VALUES (1, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expiry_date = excluded.expiry_date,
            granted_scopes = excluded.granted_scopes,
            email = excluded.email
        `,
          )
          .run(
            input.accessToken,
            input.refreshToken,
            input.expiryDate,
            input.grantedScopes,
            input.email,
          );
      },
      deleteConnection() {
        connection
          .prepare("DELETE FROM email_assistant_connection WHERE id = 1")
          .run();
      },
      deleteExpiredOAuthTransactions(before: number) {
        connection
          .prepare(
            "DELETE FROM email_assistant_oauth_transaction WHERE created_at < ?",
          )
          .run(before);
      },
      createOAuthTransaction(
        state: string,
        transaction: EmailAssistantOAuthTransaction,
      ) {
        connection
          .prepare(
            "INSERT INTO email_assistant_oauth_transaction (state, code_verifier, created_at) " +
              "VALUES (?, ?, ?)",
          )
          .run(state, transaction.codeVerifier, transaction.createdAt);
      },
      consumeOAuthTransaction(state: string) {
        const transaction = connection
          .prepare(
            "SELECT code_verifier, created_at FROM email_assistant_oauth_transaction " +
              "WHERE state = ?",
          )
          .get(state) as
          | { code_verifier: string; created_at: number }
          | undefined;
        connection
          .prepare(
            "DELETE FROM email_assistant_oauth_transaction WHERE state = ?",
          )
          .run(state);
        return (
          transaction && {
            codeVerifier: transaction.code_verifier,
            createdAt: transaction.created_at,
          }
        );
      },
      listEvaluations() {
        const rows = connection
          .prepare(
            `
          SELECT message_id, sender, subject, received_at, description, category, suggested_category
          FROM email_assistant_evaluation
          ORDER BY received_at ASC, message_id ASC
        `,
          )
          .all() as Array<{
          message_id: string;
          sender: string;
          subject: string;
          received_at: string;
          description: string;
          category: string | null;
          suggested_category: string | null;
        }>;
        return rows.map((row) => ({
          messageId: row.message_id,
          from: row.sender,
          subject: row.subject,
          receivedAt: row.received_at,
          description: row.description,
          ...(row.category ? { category: row.category } : {}),
          ...(row.suggested_category
            ? { suggestedCategory: row.suggested_category }
            : {}),
        }));
      },
      saveEvaluation(input: EmailAssistantEvaluation) {
        connection
          .prepare(
            `
          INSERT INTO email_assistant_evaluation (
            message_id, sender, subject, received_at, description, category, suggested_category
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(message_id) DO UPDATE SET
            sender = excluded.sender, subject = excluded.subject,
            received_at = excluded.received_at,
            description = excluded.description, category = excluded.category,
            suggested_category = excluded.suggested_category
        `,
          )
          .run(
            input.messageId,
            input.from,
            input.subject,
            input.receivedAt,
            input.description,
            input.category ?? null,
            input.suggestedCategory ?? null,
          );
      },
      confirmEvaluationCategory(messageId: string, category: string) {
        connection
          .prepare(
            `
          UPDATE email_assistant_evaluation
          SET category = ?, suggested_category = NULL
          WHERE message_id = ?
        `,
          )
          .run(category, messageId);
      },
    },
  };
  return {
    plugin: { manifest: databasePluginManifest, register() {} },
    operations,
  };
}
