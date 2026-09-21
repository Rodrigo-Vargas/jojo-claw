# Jojo Claw

Jojo Claw is a barebones local AI platform. Plugins are local packages in `packages/`, composed explicitly by the API and web app at startup/build time. A server plugin receives the platform's AI capability in its `register()` function, so it never needs Ollama's URL, request format, or model lifecycle details. A browser plugin can register pages in the application.

```text
plugin package → Jojo Claw API → Ollama
```

This first slice deliberately does **not** load packages dynamically, stream output, or expose tools/agent loops. Installed packages are explicit API composition imports, which keeps the first security and lifecycle model easy to inspect.

## Run

Start Ollama and install a model, then configure its name if you do not use the default `llama3.2`:

```sh
ollama pull llama3.2
npm install
OLLAMA_MODEL=llama3.2 npm run dev:api
```

In a second terminal, start the React application:

```sh
npm run dev:web
```

Open `http://localhost:5173`. Vite proxies API calls to the server at `http://localhost:8788`. Set `OLLAMA_BASE_URL` when Ollama is not at `http://127.0.0.1:11434`.

## Try the platform

The API includes `@jojo-claw/text-plugin`, an installed package that exposes basic text generation. List locally installed plugins:

```sh
curl http://localhost:8788/api/plugins
```

Call that plugin's route:

```sh
curl -X POST http://localhost:8788/api/plugins/text/generate \
  -H 'content-type: application/json' \
  -d '{"system":"Be concise.","prompt":"Explain why plugin boundaries matter."}'
```

`GET /api/plugins` lists the packages mounted by the API, and `GET /health` provides a basic readiness check.

## Connect Email Assistant to Gmail

Email Assistant uses the OAuth authorization-code flow with PKCE. In Google Cloud, enable the Gmail API, configure an OAuth client, and register this redirect URI (or the value chosen for `JOJO_GOOGLE_REDIRECT_URI`):

```text
http://localhost:8788/api/plugins/email-assistant/oauth/callback
```

In the **Secrets** page, configure `email-assistant/google-client-id` and `email-assistant/connection-encryption-key`. Generate the encryption key once and retain it: changing it makes existing local Gmail connections unreadable.

```sh
openssl rand -base64 32
```

Set the output as `email-assistant/connection-encryption-key`; set `email-assistant/google-client-secret` too when the selected Google OAuth client requires one. Then open Email assistant and choose **Connect Gmail**. The plugin requests only Gmail read access and stores access/refresh tokens encrypted in `.jojo-claw/email-assistant.db`.

The current Secrets plugin keeps values only for the API process lifetime. After an API restart, enter the same three values again before using the saved Gmail connection; a durable secret vault is a remaining platform enhancement.

## Structure

```text
apps/
  api/                 HTTP composition root
  web/                 browser application placeholder
packages/
  core/                server and browser plugin contracts
  ollama/              Ollama provider adapter
  text-plugin/         first local package using the AI capability
```

`apps/api` owns HTTP and explicitly composes installed server packages. `apps/web` explicitly imports installed browser entries and mounts their pages. `packages/core` defines both boundaries, while `packages/ollama` is the only place that knows Ollama's API.

To add another plugin, create a package under `packages/`, export a server `PlatformPlugin` and/or browser `WebPlatformPlugin`, then explicitly include it in the corresponding host composition list. Browser pages must live beneath `/plugins/<plugin-id>` and are rendered in host navigation.

## Checks

```sh
npm run build
npm test
```
