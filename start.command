#!/bin/bash
set -e
cd "$(dirname "$0")"
# Use the installed desktop runtime on this Mac when node/pnpm are not on PATH.
if ! command -v pnpm >/dev/null 2>&1; then
  export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
fi
pnpm dev
