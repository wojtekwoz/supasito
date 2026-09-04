#!/usr/bin/env bash
# Build the release app. Add --install to copy it into /Applications (replacing an older copy).
set -euo pipefail
cd "$(dirname "$0")/.."
if pgrep -f "target/debug/open" >/dev/null; then
  echo "A dev instance of Open is running (pnpm tauri dev). Quit it first so the two don't share state at once." >&2
  exit 1
fi
pnpm tauri build
APP="src-tauri/target/release/bundle/macos/Open.app"
echo "Built $APP ($(du -sh "$APP" | cut -f1))"
if [[ "${1:-}" == "--install" ]]; then
  rm -rf /Applications/Open.app
  cp -R "$APP" /Applications/Open.app
  echo "Installed /Applications/Open.app"
fi
