#!/bin/bash
# Builds Keystone.app — a native macOS window around the Keystone PM server (same pattern as Codex.app) —, installs
# it in ~/Applications and puts an alias « Keystone » on the Desktop (the app itself stays out of the Desktop, which
# iCloud may sync and evict).
# The app uses a Keystone server already running on port 3000 (npm run dev) when there is one; otherwise it runs this
# project's production build (rebuilt automatically when the code changes) with its data in
# ~/Library/Application Support/Keystone and its server log in ~/Library/Logs/Keystone. Usage: npm run app
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="$(pwd)"

NODE="$(command -v node || true)"
for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do [[ -z "$NODE" && -x "$candidate" ]] && NODE="$candidate"; done
[[ -x "$NODE" ]] || { echo "Node.js introuvable" >&2; exit 1; }
NODE="$(cd "$(dirname "$NODE")" && pwd -P)/$(basename "$NODE")" # resolve symlinks once, at build time
VERSION="$("$NODE" -p "require('./package.json').version")"
ARCH="$(uname -m)"
APP="$HOME/Applications/Keystone.app"
if pgrep -f "$APP/Contents/MacOS/Keystone" >/dev/null; then
  echo "Keystone est ouvert : quittez-le (⌘Q) puis relancez npm run app." >&2
  exit 1
fi
# Only ever delete bundles that are this app.
ours() { [[ "$(plutil -extract CFBundleIdentifier raw "$1/Contents/Info.plist" 2>/dev/null)" == "com.epc2i.keystone" ]]; }
OUT="desktop/dist/Keystone.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "› Compilation de l'application (Swift, $ARCH)…"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
swiftc -O -swift-version 5 -target "$ARCH-apple-macos13" desktop/KeystoneApp.swift -o "$OUT/Contents/MacOS/Keystone"

echo "› Icône…"
swiftc -O -swift-version 5 desktop/make-icon.swift -o "$TMP/make-icon"
"$TMP/make-icon" "$TMP/icon.png"
mkdir "$TMP/Keystone.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$TMP/Keystone.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$TMP/icon.png" --out "$TMP/Keystone.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/Keystone.iconset" -o "$OUT/Contents/Resources/Keystone.icns"

PLIST="$OUT/Contents/Info.plist"
plutil -create xml1 "$PLIST"
plutil -insert CFBundleName -string "Keystone" "$PLIST"
plutil -insert CFBundleDisplayName -string "Keystone" "$PLIST"
plutil -insert CFBundleIdentifier -string "com.epc2i.keystone" "$PLIST"
plutil -insert CFBundleExecutable -string "Keystone" "$PLIST"
plutil -insert CFBundleIconFile -string "Keystone" "$PLIST"
plutil -insert CFBundlePackageType -string "APPL" "$PLIST"
plutil -insert CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -insert CFBundleVersion -string "$(date +%Y%m%d%H%M)" "$PLIST"
plutil -insert LSMinimumSystemVersion -string "13.0" "$PLIST"
plutil -insert LSApplicationCategoryType -string "public.app-category.productivity" "$PLIST"
plutil -insert NSHighResolutionCapable -bool true "$PLIST"
plutil -insert NSHumanReadableCopyright -string "Système EPC2i — Gestion de projets" "$PLIST"
plutil -insert NSAppTransportSecurity -dictionary "$PLIST"
plutil -insert NSAppTransportSecurity.NSAllowsLocalNetworking -bool true "$PLIST"
plutil -insert KeystoneProjectDir -string "$PROJECT" "$PLIST"
plutil -insert KeystoneNodePath -string "$NODE" "$PLIST"

echo "› Build de production de Keystone (évite l'attente à la première ouverture)…"
# `next build` type-checks the project: it needs more than Node's default ~2 GB heap.
NODE_OPTIONS="--max-old-space-size=4096 ${NODE_OPTIONS:-}" NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 "$NODE" node_modules/next/dist/bin/next build >/dev/null

xattr -cr "$OUT"
codesign --force --deep --sign - "$OUT" >/dev/null
codesign --verify --deep --strict "$OUT"

mkdir -p "$HOME/Applications"
if [[ -e "$APP" ]]; then ours "$APP" || { echo "$APP existe et n'est pas Keystone : abandon." >&2; exit 1; }; rm -rf "$APP"; fi
ditto "$OUT" "$APP"

swiftc -O -swift-version 5 desktop/make-alias.swift -o "$TMP/make-alias"
"$TMP/make-alias" "$APP" "$HOME/Desktop/Keystone"
echo "✓ Keystone installée dans ~/Applications, alias « Keystone » sur le bureau"
