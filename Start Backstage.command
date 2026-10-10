#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
export BACKSTAGE_PYTHON="${BACKSTAGE_PYTHON:-$PWD/.venv/bin/python}"
for app in "$PWD/desktop/release/Backstage-darwin-arm64/Backstage.app" "$PWD/desktop/release/Backstage-darwin-x64/Backstage.app"; do
  if [ -d "$app" ]; then exec "$app/Contents/MacOS/Backstage"; fi
done
printf '%s\n' 'Build the desktop app first: npm --prefix desktop ci && npm --prefix desktop run package'
exit 1
