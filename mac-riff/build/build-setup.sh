#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
app="$PWD/MacRiff Setup.app"
payload="$app/Contents/Resources/Runtime"
mkdir -p "$app/Contents/MacOS" "$payload/build" "$payload/bin"
swiftc -parse-as-library -O -framework SwiftUI -framework AppKit -framework IOKit -framework CoreMIDI setup-model.swift setup.swift -o "$app/Contents/MacOS/MacRiffSetup"
clang -fobjc-arc -fblocks -O2 -dynamiclib -arch arm64 -arch x86_64 -mmacosx-version-min=11.0 -framework Foundation -framework GameController controller-adapter.m -o "$payload/build/libMacRiffController.dylib"
clang -fobjc-arc -fblocks -O2 -framework Foundation controller-test-host.m -o "$payload/build/controller-test-host"
swiftc configure-clone-hero.swift -o "$payload/build/configure-clone-hero"
cp -c bridge.js controller-reader.js controller-output.js receiver-selector.js device-inventory.js session-plan.js session-manager.js reader-group.js authorize-readers.sh authorize-reader.sh prepare-bundled-game.sh 'Play Clone Hero.command' CONTROLLER-MODE.md restore-controller-settings.swift "$payload/"
cp -cR profiles "$payload/"
node_binary="$(command -v node)"
"$node_binary" -e 'if (Number(process.versions.node.split(".")[0]) < 16) process.exit(1)'
cp -c "$node_binary" "$payload/bin/node"
if [ -d node_modules/usb ]; then modules=node_modules; else modules=MacRiff.app/Contents/Resources/node_modules; fi
[ -d "$modules/usb" ] || { echo "USB dependency is missing."; exit 1; }
mkdir -p "$payload/node_modules"
cp -cR "$modules/." "$payload/node_modules/"
touch "$payload/bundled-runtime"
uuidgen > "$payload/payload-version"
for binary in "$payload/build/libMacRiffController.dylib" "$payload/build/controller-test-host" "$payload/build/configure-clone-hero"; do
    codesign --force --sign - "$binary"
done
python3 -c 'import plistlib,sys; plistlib.dump(dict(CFBundleExecutable="MacRiffSetup",CFBundleIdentifier="local.macriff.setup",CFBundleName="MacRiff Setup",CFBundlePackageType="APPL",CFBundleShortVersionString="0.4.2",CFBundleVersion="6",LSMultipleInstancesProhibited=True,LSMinimumSystemVersion="13.0",NSHighResolutionCapable=True),open(sys.argv[1],"wb"))' "$app/Contents/Info.plist"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
echo "Ready: $app"
