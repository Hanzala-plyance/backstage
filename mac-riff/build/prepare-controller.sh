#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

game_source="${MACRIFF_GAME_APP:-/Applications/Clone Hero.app}"
game_copy="$PWD/build/Clone Hero (MacRiff).app"
if [ ! -x "$game_source/Contents/MacOS/Clone Hero" ]; then
    echo "Clone Hero was not found at $game_source. Set MACRIFF_GAME_APP to its app path."
    exit 1
fi
mkdir -p build
echo "Building the controller adapter..."
clang -fobjc-arc -fblocks -O2 -dynamiclib -arch arm64 -arch x86_64 \
    -mmacosx-version-min=11.0 -framework Foundation -framework GameController \
    controller-adapter.m -o build/libMacRiffController.dylib
codesign --force --sign - build/libMacRiffController.dylib

if [ ! -d "$game_copy" ]; then
    echo "Preparing a separate copy of Clone Hero..."
    # APFS copy-on-write avoids duplicating all of the game's data on disk.
    if ! /bin/cp -cR "$game_source" "$game_copy"; then
        /bin/cp -R "$game_source/." "$game_copy/"
    fi
    /usr/libexec/PlistBuddy -c 'Set :CFBundleName Clone Hero (MacRiff)' "$game_copy/Contents/Info.plist"
fi

# Locally sign the copy so it can load our application-local controller adapter.
# No privileged system setting or original game file is changed.
codesign --force --sign - "$game_copy"
codesign --verify --deep --strict "$game_copy"
echo "Ready. Launch using Play Clone Hero.command."
