#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
game_source="${MACRIFF_GAME_APP:-/Applications/Clone Hero.app}"
game_copy="$PWD/build/Clone Hero (MacRiff).app"
[ -x "$game_source/Contents/MacOS/Clone Hero" ] || { echo "Install Clone Hero in Applications first."; exit 1; }
if [ ! -d "$game_copy" ]; then
    echo "Preparing Clone Hero for first use. This can take a moment..."
    if ! /bin/cp -cR "$game_source" "$game_copy"; then
        /bin/cp -R "$game_source/." "$game_copy/"
    fi
    /usr/libexec/PlistBuddy -c 'Set :CFBundleName Clone Hero (MacRiff)' "$game_copy/Contents/Info.plist"
    /usr/bin/codesign --force --sign - "$game_copy"
fi
/usr/bin/codesign --verify --deep --strict "$game_copy"
