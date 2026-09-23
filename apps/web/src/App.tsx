import { Suspense, useEffect, useState } from "react";
import { textWebPlugin } from "@jojo-claw/text-plugin/web";
import { secretsWebPlugin } from "@jojo-claw/secrets-plugin/web";
import { settingsWebPlugin } from "@jojo-claw/settings-plugin/web";
import { emailAssistantWebPlugin } from "@jojo-claw/email-assistant/web";
import { toolCallingWebPlugin } from "@jojo-claw/tool-calling-plugin/web";
import { promptsWebPlugin } from "@jojo-claw/prompt-plugin/web";
import { mountWebPlugins } from "./plugin-registry.js";
import { PromptQueueWidget } from "./PromptQueueWidget.js";

// Installed browser plugins are deliberately composed here at build time.
const pages = mountWebPlugins([
  textWebPlugin,
  toolCallingWebPlugin,
  emailAssistantWebPlugin,
  promptsWebPlugin,
  secretsWebPlugin,
  settingsWebPlugin,
]);
const defaultPage = pages[0];

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const page =
    pages.find((candidate) => candidate.path === path) ?? defaultPage;

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextPath: string) {
    if (nextPath === path) return;
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  const Page = page.component;
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">J</span>
          <span>Jojo Claw</span>
        </div>
        <button className="new-run" onClick={() => navigate(defaultPage.path)}>
          <span>+</span> New generation
        </button>
        <div className="nav-label">Plugins</div>
        <nav>
          {pages.map((candidate) => (
            <a
              className={`nav-item${candidate.path === page.path ? " active" : ""}`}
              href={candidate.path}
              key={candidate.path}
              onClick={(event) => {
                event.preventDefault();
                navigate(candidate.path);
              }}
            >
              <span>◈</span> {candidate.navLabel}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" /> Local Ollama{" "}
          <span className="gear">⚙</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{page.navLabel.toUpperCase()}</p>
            <h1>{page.title}</h1>
          </div>
          <span className="connection">● API connected</span>
        </header>
        <Suspense fallback={<p className="muted">Loading page…</p>}>
          <Page />
        </Suspense>
      </main>

      <PromptQueueWidget />
    </div>
  );
}
