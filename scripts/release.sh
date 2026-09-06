#!/usr/bin/env bash
# Build the release app.
#   pnpm release              Supasito.app (unsigned unless the Apple variables below are set)
#   pnpm release --install    …and copy it into /Applications (replacing an older copy)
#   pnpm release --zip        …also release/Supasito-<version>-macos.zip to hand to other Macs. Unsigned
#                             ("underground") builds: the recipient runs
#                             xattr -dr com.apple.quarantine /Applications/Supasito.app once, or uses
#                             System Settings → Privacy & Security → Open Anyway.
#   pnpm release --dmg        …also a DMG (needs an interactive session: the DMG step drives Finder)
#
# Signing and notarization are picked up by the Tauri CLI from the environment. Put these in
# .env.release (gitignored) or export them before running:
#   APPLE_SIGNING_IDENTITY   "Developer ID Application: Your Name (TEAMID)"  → signs the app
#   APPLE_ID, APPLE_PASSWORD (app-specific), APPLE_TEAM_ID               → notarizes it
#   or APPLE_API_ISSUER, APPLE_API_KEY, APPLE_API_KEY_PATH instead of the three above
# Without APPLE_SIGNING_IDENTITY the app runs here but other Macs show Gatekeeper's warning.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env.release ]]; then set -a; source .env.release; set +a; fi

INSTALL=0; DMG=0; ZIP=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    --dmg) DMG=1 ;;
    --zip) ZIP=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if pgrep -f "target/debug/supasito" >/dev/null; then
  echo "A dev instance of Supasito is running (pnpm tauri dev). Quit it first so the two don't share state at once." >&2
  exit 1
fi

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "Signing as: $APPLE_SIGNING_IDENTITY"
  if [[ -n "${APPLE_ID:-}" || -n "${APPLE_API_KEY:-}" ]]; then echo "Notarizing: yes"; else echo "Notarizing: no (set APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID to notarize)"; fi
else
  echo "Unsigned build: fine on this Mac; other Macs will show Gatekeeper's warning. See scripts/release.sh for the variables."
fi

BUNDLES="app"
[[ $DMG -eq 1 ]] && BUNDLES="app,dmg"
pnpm tauri build --bundles "$BUNDLES"

APP="src-tauri/target/release/bundle/macos/Supasito.app"
echo "Built $APP ($(du -sh "$APP" | cut -f1))"
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  codesign --verify --deep --strict "$APP" && echo "Signature verifies."
  spctl --assess --type execute -v "$APP" 2>&1 | sed 's/^/Gatekeeper: /' || true
fi
if [[ $DMG -eq 1 ]]; then
  DMGFILE=$(ls -t src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)
  [[ -n "$DMGFILE" ]] && echo "Disk image: $DMGFILE ($(du -sh "$DMGFILE" | cut -f1))"
fi
if [[ $ZIP -eq 1 ]]; then
  VERSION=$(node -p "require('./package.json').version")
  mkdir -p release
  ZIPFILE="release/Supasito-$VERSION-macos.zip"
  rm -f "$ZIPFILE"
  ditto -c -k --keepParent "$APP" "$ZIPFILE"
  echo "Zip: $ZIPFILE ($(du -sh "$ZIPFILE" | cut -f1))"
  if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    cat <<'MSG'
This zip is unsigned. Tell whoever installs it: drag Supasito.app to /Applications, then run
  xattr -dr com.apple.quarantine /Applications/Supasito.app
in Terminal (or open it once, dismiss the warning, and use System Settings → Privacy & Security → Open Anyway).
MSG
  fi
fi
if [[ $INSTALL -eq 1 ]]; then
  rm -rf /Applications/Supasito.app
  cp -R "$APP" /Applications/Supasito.app
  echo "Installed /Applications/Supasito.app"
fi
