#!/usr/bin/env bash

set -euo pipefail

readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REQUIRED_NODE_MAJOR=22
readonly OLLAMA_MODEL_NAME="${OLLAMA_MODEL:-}"

require_command() {
  local command_name="$1"

  if command -v "$command_name" >/dev/null 2>&1; then
    return
  fi

  printf 'Missing required command: %s\n' "$command_name" >&2
  exit 1
}

require_supported_node() {
  local node_major

  node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
  if (( node_major >= REQUIRED_NODE_MAJOR )); then
    return
  fi

  printf 'Node.js %s or newer is required; found %s.\n' "$REQUIRED_NODE_MAJOR" "$(node --version)" >&2
  exit 1
}

install_dependencies() {
  printf 'Installing Node.js dependencies...\n'
  npm ci
}

stop_development_servers() {
  local exit_status=$?

  trap - EXIT INT TERM
  kill "$API_PROCESS_ID" "$WEB_PROCESS_ID" 2>/dev/null || true
  wait "$API_PROCESS_ID" "$WEB_PROCESS_ID" 2>/dev/null || true
  exit "$exit_status"
}

start_development_servers() {
  printf 'Starting API server at http://localhost:8788...\n'
  OLLAMA_MODEL="$OLLAMA_MODEL_NAME" npm run dev:api &
  API_PROCESS_ID=$!

  printf 'Starting web server at http://localhost:5173...\n'
  npm run dev:web &
  WEB_PROCESS_ID=$!

  trap stop_development_servers EXIT INT TERM
  wait -n "$API_PROCESS_ID" "$WEB_PROCESS_ID"
}

main() {
  cd "$PROJECT_ROOT"
  require_command node
  require_command npm
  require_supported_node
  install_dependencies
  start_development_servers
}

main "$@"
