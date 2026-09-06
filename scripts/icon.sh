#!/usr/bin/env bash
# Regenerate the app icon set from the Icon Composer source.
#   pnpm icon
# src-tauri/icons/Supasito.icon is the editable source (open it in Icon Composer, which ships with
# Xcode 26). This compiles it with actool into src-tauri/icons/Assets.car, the layered glass icon
# macOS 26 draws in the light, dark and tinted appearances (src-tauri/Info.plist names it through
# CFBundleIconName), and builds the flat PNG / icns / ico set Tauri bundles for older systems and
# other platforms from Icon Composer's 1024px default-appearance export (File → Export…), saved as
# src-tauri/icons/default-1024.png, inset to the macOS icon grid.
set -euo pipefail
cd "$(dirname "$0")/.."
ICONS=src-tauri/icons
TMP=$(mktemp -d)
xcrun actool --compile "$TMP" --app-icon Supasito --include-all-app-icons --platform macosx \
  --minimum-deployment-target 12.0 --output-partial-info-plist "$TMP/partial.plist" \
  --output-format human-readable-text "$ICONS/Supasito.icon" >/dev/null
cp "$TMP/Assets.car" "$ICONS/Assets.car"
swift scripts/icon-pad.swift "$ICONS/default-1024.png" "$TMP/icon-1024.png"
pnpm tauri icon "$TMP/icon-1024.png" -o "$ICONS"
rm -rf "$ICONS/android" "$ICONS/ios" "$TMP"
echo "Icons regenerated in $ICONS: Assets.car for macOS 26, PNG/icns/ico for everything else."
