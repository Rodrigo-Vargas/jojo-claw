/* eslint-disable max-lines-per-function -- This page coordinates secret reveal state. */
import { FormEvent, useEffect, useState } from "react";

interface ManagedSecret {
  pluginId: string;
  id: string;
  name: string;
  description?: string;
  configured: boolean;
}

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<ManagedSecret[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function load() {
    const response = await fetch("/api/plugins/secrets/list", {
      method: "POST",
    });
    if (!response.ok) throw new Error(await messageFrom(response));
    const result = (await response.json()) as {
      result: { secrets: ManagedSecret[] };
    };
    setSecrets(result.result.secrets);
  }

  useEffect(() => {
    void load().catch((cause: unknown) => setError(messageOf(cause)));
  }, []);

  async function save(
    event: FormEvent<HTMLFormElement>,
    secret: ManagedSecret,
  ) {
    event.preventDefault();
    setMessage(undefined);
    setError(undefined);
    const value = values[keyOf(secret)] ?? "";
    try {
      const response = await fetch("/api/plugins/secrets/set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pluginId: secret.pluginId,
          id: secret.id,
          value,
        }),
      });
      if (!response.ok) throw new Error(await messageFrom(response));
      await load();
      setValues((current) => ({ ...current, [keyOf(secret)]: "" }));
      setRevealed((current) => {
        const next = { ...current };
        delete next[keyOf(secret)];
        return next;
      });
      setMessage(value ? `${secret.name} saved.` : `${secret.name} cleared.`);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function toggleReveal(secret: ManagedSecret) {
    const key = keyOf(secret);
    if (revealed[key] !== undefined) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    setError(undefined);
    try {
      const response = await fetch("/api/plugins/secrets/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pluginId: secret.pluginId, id: secret.id }),
      });
      if (!response.ok) throw new Error(await messageFrom(response));
      const payload = (await response.json()) as { result: { value?: string } };
      if (payload.result.value === undefined)
        throw new Error(`${secret.name} is not configured.`);
      setRevealed((current) => ({
        ...current,
        [key]: payload.result.value as string,
      }));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  return (
    <section className="conversation secrets-page">
      <div className="intro">
        <div className="plugin-icon">⌘</div>
        <div>
          <h2>Plugin secrets</h2>
          <p>
            Secrets are stored locally in the gitignored <code>.env</code> file
            and are never sent back to this page.
          </p>
        </div>
      </div>
      {secrets.length === 0 && !error && (
        <p className="muted">No installed plugin has requested a secret.</p>
      )}
      <div className="secrets-list">
        {secrets.map((secret) => (
          <form
            className="secret-card"
            key={keyOf(secret)}
            onSubmit={(event) => void save(event, secret)}
          >
            <div>
              <strong>{secret.name}</strong>
              <code>
                {secret.pluginId}/{secret.id}
              </code>
              {secret.description && <p>{secret.description}</p>}
            </div>
            <div className="secret-actions">
              <span
                className={`secret-status${secret.configured ? " configured" : ""}`}
              >
                {secret.configured ? "Configured" : "Not configured"}
              </span>
              {secret.configured && (
                <button
                  className="secret-reveal"
                  type="button"
                  aria-label={
                    `${revealed[keyOf(secret)] !== undefined ? "Hide" : "Show"} ` +
                    `stored ${secret.name}`
                  }
                  onClick={() => void toggleReveal(secret)}
                >
                  {revealed[keyOf(secret)] !== undefined ? "◉" : "◉̸"}
                </button>
              )}
            </div>
            {revealed[keyOf(secret)] !== undefined && (
              <label className="revealed-value">
                Stored value
                <input readOnly type="text" value={revealed[keyOf(secret)]} />
              </label>
            )}
            <label>
              New value
              <input
                type="password"
                autoComplete="off"
                value={values[keyOf(secret)] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [keyOf(secret)]: event.target.value,
                  }))
                }
                placeholder={
                  secret.configured ? "Leave blank to clear" : "Enter a value"
                }
              />
            </label>
            <button type="submit">
              {(values[keyOf(secret)] ?? "") ? "Save secret" : "Clear secret"}
            </button>
          </form>
        ))}
      </div>
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}

function keyOf(secret: ManagedSecret): string {
  return `${secret.pluginId}:${secret.id}`;
}
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error.";
}
async function messageFrom(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: string };
  return body.error ?? "Request failed.";
}
