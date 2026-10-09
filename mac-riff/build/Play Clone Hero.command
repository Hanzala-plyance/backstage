#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

# Serialize starts, including the time spent in the macOS password dialog.
mkdir -p build
launch_lock="$PWD/build/controller-launch.lock"
if ! mkdir "$launch_lock" 2>/dev/null; then
    lock_pid=$(cat "$launch_lock/pid" 2>/dev/null || true)
    if [[ "$lock_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
        rm -f "$launch_lock/pid"
        rmdir "$launch_lock" 2>/dev/null || true
        mkdir "$launch_lock" 2>/dev/null || { echo "Another launch is in progress."; exit 1; }
    else
        echo "Another launch is in progress. Finish its macOS dialog or Terminal window first."
        exit 1
    fi
fi
printf '%s\n' "$$" > "$launch_lock/pid"
trap 'rm -f "$launch_lock/pid"; rmdir "$launch_lock" 2>/dev/null || true' EXIT

find_node() {
    local candidate version
    for candidate in "$PWD/bin/node" "$(command -v node || true)" \
        "$HOME"/.nvm/versions/node/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
        [ -x "$candidate" ] || continue
        version=$("$candidate" -p 'Number(process.versions.node.split(".")[0]) >= 16' 2>/dev/null || true)
        if [ "$version" = true ]; then printf '%s\n' "$candidate"; return; fi
    done
    return 1
}
node_path=$(find_node) || { echo "Node.js 16 or newer is required."; exit 1; }
game_copy="$PWD/build/Clone Hero (MacRiff).app"

# The downloaded MacRiff bundle already contains the USB dependency.
if [ -d "$PWD/node_modules/usb" ]; then
    modules_path="$PWD/node_modules"
elif [ -d "$PWD/MacRiff.app/Contents/Resources/node_modules/usb" ]; then
    modules_path="$PWD/MacRiff.app/Contents/Resources/node_modules"
else
    echo "USB dependency missing. Run npm install in this folder first."
    exit 1
fi

if /usr/bin/pgrep -f '^.*node .*bridge\.js' >/dev/null; then
    echo "Stop the existing bridge using MacRiff's Stop Bridge menu item, then run this launcher again."
    exit 1
fi

while read -r current_pid current_command; do
    if [ "$current_command" = "$game_copy/Contents/MacOS/Clone Hero" ] || \
       [ "$current_command" = "${MACRIFF_GAME_APP:-/Applications/Clone Hero.app}/Contents/MacOS/Clone Hero" ]; then
        echo "Close the running Clone Hero window, then launch this command again."
        exit 1
    fi
done < <(/bin/ps -axo pid=,comm=)

if [ -f bundled-runtime ]; then
    bash ./prepare-bundled-game.sh
elif [ ! -f build/libMacRiffController.dylib ] || [ ! -d "$game_copy" ] || [ controller-adapter.m -nt build/libMacRiffController.dylib ]; then
    bash ./prepare-controller.sh
fi

if [ ! -x build/configure-clone-hero ] || { [ -f configure-clone-hero.swift ] && [ configure-clone-hero.swift -nt build/configure-clone-hero ]; }; then
    swiftc configure-clone-hero.swift -o build/configure-clone-hero
fi
if [ -f bundled-runtime ]; then
    ./build/configure-clone-hero --preserve-existing
else
    ./build/configure-clone-hero
fi

session_dir=$(mktemp -d /tmp/macriff-controller.XXXXXX)
chmod 700 "$session_dir"
socket_path="$session_dir/controller.sock"
printf '%s\n' "$session_dir" > build/latest-controller-session.txt
echo "Starting Clone Hero with the MacRiff controller. Logs: $session_dir"
nohup /usr/bin/env MACRIFF_CONTROLLER_SOCKET="$socket_path" \
    DYLD_INSERT_LIBRARIES="$PWD/build/libMacRiffController.dylib" \
    "$game_copy/Contents/MacOS/Clone Hero" -logFile "$session_dir/game.log" \
    < /dev/null > "$session_dir/launch.log" 2>&1 &
game_pid=$!
printf '%s\n' "$game_pid" > "$session_dir/game.pid"

for ((attempt=0; attempt<100; attempt++)); do
    [ -S "$socket_path" ] && break
    if ! kill -0 "$game_pid" 2>/dev/null; then
        cat "$session_dir/launch.log"
        echo "Clone Hero could not start. Logs: $session_dir"
        exit 1
    fi
    sleep 0.1
done
if [ ! -S "$socket_path" ]; then
    echo "The controller adapter did not start. Logs: $session_dir"
    kill "$game_pid" 2>/dev/null || true
    exit 1
fi

echo "Connect and pair the guitar. Approve the macOS password dialog if requested."
echo "Riffmaster defaults are installed. Use the 5-fret guitar profile with Gamepad Mode off."
if ! /usr/bin/osascript - "$modules_path" "$node_path" "$PWD/controller-reader.js" \
    "$socket_path" "$session_dir/bridge.log" <<'APPLESCRIPT'
on run argv
    set commandText to "/usr/bin/env " & quoted form of ("NODE_PATH=" & item 1 of argv) & " " & quoted form of item 2 of argv & " " & quoted form of item 3 of argv & " --socket " & quoted form of item 4 of argv & " > " & quoted form of item 5 of argv & " 2>&1 < /dev/null &"
    do shell script commandText with administrator privileges
end run
APPLESCRIPT
then
    echo "USB access was not authorized. Run this launcher when you are ready to start."
    kill "$game_pid" 2>/dev/null || true
    exit 1
fi
reader_ready=false
for ((attempt=0; attempt<300; attempt++)); do
    kill -0 "$game_pid" 2>/dev/null || break
    if [ -f "$session_dir/bridge.log" ] && \
       /usr/bin/grep -q 'Starting packet polling' "$session_dir/bridge.log" && \
       /usr/bin/grep -q '\[Controller\] Connected to Clone Hero' "$session_dir/bridge.log" && \
       /usr/bin/grep -q 'MacRiff detected=yes' "$session_dir/launch.log" "$session_dir/game.log" 2>/dev/null; then
        reader_ready=true
        break
    fi
    sleep 0.1
done
if [ "$reader_ready" != true ]; then
    echo "The USB reader or game registration check did not complete. Logs: $session_dir"
    tail -20 "$session_dir/bridge.log" 2>/dev/null || true
    kill "$game_pid" 2>/dev/null || true
    exit 1
fi
if /usr/bin/grep -q 'Delivered input:' "$session_dir/launch.log" "$session_dir/game.log" 2>/dev/null; then
    echo "PASS: USB reader connected, game detected MacRiff, and guitar reports received."
else
    echo "Game detected MacRiff; waiting for guitar input. Turn on/pair the guitar and press a fret."
fi
echo "Controller mode started. You may close this Terminal window."
echo "Quitting the game stops the USB reader automatically. Logs: $session_dir"
