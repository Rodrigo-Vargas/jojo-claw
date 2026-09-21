# Jojo Claw

Jojo Claw is a barebones local AI platform. Plugins are Node packages in `packages/`, composed by the API at startup. A plugin receives the platform's AI capability in its `register()` function, so it never needs Ollama's URL, request format, or model lifecycle details.

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

## Structure

```text
apps/
  api/                 HTTP composition root
  web/                 browser application placeholder
packages/
  core/                plugin contracts and AI capability types
  ollama/              Ollama provider adapter
  text-plugin/         first local package using the AI capability
```

`apps/api` owns HTTP and explicitly composes the installed packages. `packages/core` defines the plugin boundary, while `packages/ollama` is the only place that knows Ollama's API. `apps/web` is deliberately a minimal landing page until the API shape is approved.

To add another plugin, create a package under `packages/`, export a `PlatformPlugin`, add it to `apps/api` dependencies, then include it in the `plugins` list in `apps/api/src/server.ts`.

## Checks

```sh
npm run build
npm test
```
