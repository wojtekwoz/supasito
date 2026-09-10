#!/usr/bin/env bash
# Build the release app.
#   pnpm release              Supasito.app (unsigned unless the Apple variables below are set)
#   pnpm release --install    …and copy it into /Applications (replacing an older copy)
#   pnpm release --zip        …also release/Supasito-<version>-macos.zip to hand to other Macs. Signed
#                             builds open normally; unsigned ("underground") ones need the recipient to
#                             run xattr -dr com.apple.quarantine /Applications/Supasito.app once, or use
#                             System Settings → Privacy & Security → Open Anyway.
#   pnpm release --dmg        …also a DMG (needs an interactive session: the DMG step drives Finder)
#
# Every build also produces the updater package (Supasito.app.tar.gz + .sig) and release/latest.json,
# which is what installed copies read to learn a newer version exists. Both belong on the GitHub release
# next to the zip; latest.json also goes to supasito.com/updates/latest.json, which is the copy that gets
# asked first and so is the one that counts installs. See src-tauri/src/updates.rs.
#
# Signing and notarization are picked up by the Tauri CLI from the environment. Put these in
# .env.release (gitignored) or export them before running:
#   APPLE_SIGNING_IDENTITY   "Developer ID Application: Your Name (TEAMID)"  → signs the app
#   APPLE_ID, APPLE_PASSWORD (app-specific), APPLE_TEAM_ID               → notarizes it
#   or APPLE_API_ISSUER, APPLE_API_KEY, APPLE_API_KEY_PATH instead of the three above
#   TAURI_SIGNING_PRIVATE_KEY       path to the updater key (~/.private/supasito-signing/updater.key)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password; must be set even when empty, or the build waits on a prompt
# Without APPLE_SIGNING_IDENTITY the app runs here but other Macs show Gatekeeper's warning.
# On the machine this was set up on (2026-09-08) .env.release names the Developer ID identity for team
# AR9C3X8J27 and an App Store Connect API key; the .p8 and the certificate's key live in
# ~/.private/supasito-signing/, outside the repo. Nothing secret belongs in this file or in git.
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

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" || -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD+set}" ]]; then
  cat >&2 <<'MSG'
The updater key is not set, and tauri.conf.json asks for updater artifacts, so the build would fail
(or stop at a password prompt with no terminal to answer it). Put both of these in .env.release —
the key itself stays outside the repo:
  TAURI_SIGNING_PRIVATE_KEY=$HOME/.private/supasito-signing/updater.key
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
If the key is gone, `pnpm tauri signer generate -w …` makes a new pair — but a new pubkey in
tauri.conf.json means copies already installed will refuse every future update.
MSG
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
  # The notarization ticket must be stapled, or a Mac that is offline on first launch still warns.
  xcrun stapler validate "$APP" >/dev/null 2>&1 \
    && echo "Notarization ticket stapled." \
    || echo "No stapled ticket (expected if this build was signed but not notarized)."
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
# The updater package and the manifest installed copies read. `{{target}}` in the endpoint resolves to
# `darwin`, and only the arch this ran on is listed: an arm64 build must not be offered to an Intel Mac.
TARBALL="src-tauri/target/release/bundle/macos/Supasito.app.tar.gz"
if [[ -f "$TARBALL" && -f "$TARBALL.sig" ]]; then
  VERSION=$(node -p "require('./package.json').version")
  mkdir -p release
  cp "$TARBALL" "$TARBALL.sig" release/
  ARCH="darwin-$(uname -m | sed 's/arm64/aarch64/')"
  NOTES_FILE="release/notes-$VERSION.md"
  [[ -f "$NOTES_FILE" ]] || NOTES_FILE=""
  ARCH="$ARCH" VERSION="$VERSION" NOTES_FILE="$NOTES_FILE" node -e '
    const fs = require("fs");
    const { ARCH, VERSION, NOTES_FILE } = process.env;
    const manifest = {
      version: VERSION,
      notes: NOTES_FILE ? fs.readFileSync(NOTES_FILE, "utf8").trim() : "",
      pub_date: new Date().toISOString(),
      platforms: {
        [ARCH]: {
          signature: fs.readFileSync("release/Supasito.app.tar.gz.sig", "utf8").trim(),
          url: `https://github.com/wojtekwoz/supasito/releases/download/v${VERSION}/Supasito.app.tar.gz`,
        },
      },
    };
    fs.writeFileSync("release/latest.json", JSON.stringify(manifest, null, 2) + "\n");
  '
  echo "Update package: release/Supasito.app.tar.gz ($(du -sh "$TARBALL" | cut -f1)), signed"
  echo "Update manifest: release/latest.json ($ARCH, v$VERSION)"
  [[ -n "$NOTES_FILE" ]] || echo "  (no release/notes-$VERSION.md, so the notes are empty — write one before publishing)"
  cat <<MSG
  To ship it: gh release create v$VERSION --latest release/Supasito-$VERSION-macos.zip release/Supasito.app.tar.gz release/Supasito.app.tar.gz.sig release/latest.json
  (--latest matters: GitHub's releases/latest ignores a prerelease, and that path is the app's fallback endpoint.)
  and put the same latest.json at https://supasito.com/updates/latest.json.
MSG
else
  echo "No updater package was produced (expected $TARBALL and its .sig)." >&2
fi

if [[ $INSTALL -eq 1 ]]; then
  rm -rf /Applications/Supasito.app
  cp -R "$APP" /Applications/Supasito.app
  echo "Installed /Applications/Supasito.app"
fi
