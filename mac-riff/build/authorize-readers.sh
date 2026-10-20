#!/bin/bash
set -euo pipefail
/usr/bin/osascript - "$@" <<'APPLESCRIPT'
on run argv
    set commandText to "/usr/bin/env " & quoted form of ("NODE_PATH=" & item 1 of argv) & " " & quoted form of item 2 of argv & " " & quoted form of item 3 of argv & " " & quoted form of item 4 of argv & " > " & quoted form of item 5 of argv & " 2>&1 < /dev/null &"
    do shell script commandText with administrator privileges
end run
APPLESCRIPT
