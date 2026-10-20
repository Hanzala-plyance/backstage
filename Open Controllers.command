#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
app="$PWD/mac-riff/build/Backstage Controllers.app"
if [ ! -d "$app" ]; then
  echo 'Build controller setup first: cd mac-riff/build && npm ci && bash build-setup.sh'
  exit 1
fi
open "$app"
