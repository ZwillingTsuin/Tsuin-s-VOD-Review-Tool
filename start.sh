#!/bin/sh
# VOD Review Tool on macOS / Linux: starts the app and opens it in your browser. Ctrl+C stops it.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org and run this again."
  exit 1
fi
exec node --disable-warning=ExperimentalWarning src/server.js "$@"
