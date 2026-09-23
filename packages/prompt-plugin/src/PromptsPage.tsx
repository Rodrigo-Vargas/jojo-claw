import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

interface ManagedPrompt {
  pluginId: string; id: string; name: string; description?: string;
  kind: "prompt" | "system"; defaultContent: string; content: string;
}
type DisplayMode = "edit" | "preview";

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<ManagedPrompt[]>([]);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [selectedKey, setSelectedKey] = useState<string>();
  const [mode, setMode] = useState<DisplayMode>("edit");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => { void loadPrompts(setPrompts, setContents, setSelectedKey, setError); }, []);
  const selected = prompts.find((prompt) => keyOf(prompt) === selectedKey);
  return <section className="prompts-page">
    <PromptPageIntro />
    {message && <p className="success-message">{message}</p>}
    {error && <p className="error-message">{error}</p>}
    <div className="prompt-workspace">
      <PromptTabs prompts={prompts} selectedKey={selectedKey} onSelect={setSelectedKey} />
      {selected && <PromptEditor contents={contents} mode={mode} prompt={selected}
        setContents={setContents} setError={setError} setMessage={setMessage}
        setMode={setMode} setPrompts={setPrompts} setSelectedKey={setSelectedKey}
      />}
    </div>
  </section>;
}

function PromptPageIntro() {
  return <div className="intro"><div className="plugin-icon">✦</div><div>
    <h2>Managed prompts</h2>
    <p>Prompts registered by installed plugins. Changes are stored only on this machine.</p>
  </div></div>;
}

function PromptTabs(input: {
  prompts: ManagedPrompt[]; selectedKey: string | undefined;
  onSelect: Dispatch<SetStateAction<string | undefined>>;
}) {
  return <nav className="prompt-tabs" aria-label="Prompts">
    {input.prompts.map((prompt) => <button key={keyOf(prompt)} type="button"
      className={keyOf(prompt) === input.selectedKey ? "active" : ""}
      onClick={() => input.onSelect(keyOf(prompt))}
    ><span>{prompt.name}</span><small>{prompt.pluginId} · {prompt.kind}</small></button>)}
  </nav>;
}

function PromptEditor(input: {
  prompt: ManagedPrompt; contents: Record<string, string>; mode: DisplayMode;
  setContents: (contents: Record<string, string>) => void;
  setPrompts: (prompts: ManagedPrompt[]) => void;
  setSelectedKey: Dispatch<SetStateAction<string | undefined>>;
  setMode: (mode: DisplayMode) => void;
  setMessage: (message: string | undefined) => void;
  setError: (error: string | undefined) => void;
}) {
  const { prompt, contents } = input;
  const content = contents[keyOf(prompt)] ?? "";
  return <form className="prompt-editor" onSubmit={(event) => void savePrompt(event, input)}>
    <header>
      <div>
        <strong>{prompt.name}</strong>
        <code>{prompt.pluginId}/{prompt.id} · {prompt.kind}</code>
        {prompt.description && <p>{prompt.description}</p>}
      </div>
      <PromptModeTabs mode={input.mode} setMode={input.setMode} />
    </header>
    {input.mode === "edit" ? <textarea aria-label={prompt.name} value={content}
      onChange={(event) => input.setContents({ ...contents, [keyOf(prompt)]: event.target.value })}
    /> : <article className="prompt-preview"><ReactMarkdown>{content}</ReactMarkdown></article>}
    <footer>
      <span>
        {input.mode === "edit" ? "Markdown is supported in Preview." : "Previewing Markdown."}
      </span>
      <button type="submit">Save prompt</button>
    </footer>
  </form>;
}

function PromptModeTabs(input: { mode: DisplayMode; setMode: (mode: DisplayMode) => void }) {
  return <div className="prompt-mode-tabs" aria-label="Editor mode">
    {(["edit", "preview"] as const).map((mode) => <button key={mode} type="button"
      className={mode === input.mode ? "active" : ""} onClick={() => input.setMode(mode)}
    >{mode}</button>)}
  </div>;
}

async function loadPrompts(
  setPrompts: (prompts: ManagedPrompt[]) => void,
  setContents: (contents: Record<string, string>) => void,
  setSelectedKey: Dispatch<SetStateAction<string | undefined>>,
  setError: (error: string | undefined) => void,
): Promise<void> {
  try {
    const response = await fetch("/api/plugins/prompts/list", { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json() as { result: { prompts: ManagedPrompt[] } };
    setPrompts(payload.result.prompts);
    setContents(promptContents(payload.result.prompts));
    setSelectedKey((current) => current
      ?? (payload.result.prompts[0] && keyOf(payload.result.prompts[0]))); 
  } catch (cause) { setError(messageOf(cause)); }
}

function promptContents(prompts: ManagedPrompt[]): Record<string, string> {
  return Object.fromEntries(prompts.map((prompt) => [keyOf(prompt), prompt.content]));
}

async function savePrompt(event: FormEvent<HTMLFormElement>, input: {
  prompt: ManagedPrompt; contents: Record<string, string>;
  setPrompts: (prompts: ManagedPrompt[]) => void;
  setContents: (contents: Record<string, string>) => void;
  setSelectedKey: Dispatch<SetStateAction<string | undefined>>;
  setMessage: (message: string | undefined) => void;
  setError: (error: string | undefined) => void;
}): Promise<void> {
  event.preventDefault(); input.setMessage(undefined); input.setError(undefined);
  try {
    const prompt = input.prompt;
    const response = await fetch("/api/plugins/prompts/set", requestFor(prompt, input.contents));
    if (!response.ok) throw new Error(await response.text());
    await loadPrompts(input.setPrompts, input.setContents, input.setSelectedKey, input.setError);
    input.setMessage(`${prompt.name} saved.`);
  } catch (cause) { input.setError(messageOf(cause)); }
}

function requestFor(prompt: ManagedPrompt, contents: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pluginId: prompt.pluginId, id: prompt.id,
      content: contents[keyOf(prompt)] ?? "" }),
  };
}

function keyOf(prompt: ManagedPrompt): string { return `${prompt.pluginId}:${prompt.id}`; }
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Could not update prompts.";
}
