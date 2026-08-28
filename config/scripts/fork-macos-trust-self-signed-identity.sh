#!/usr/bin/env bash
# Import the fork desktop self-signed p12 so `codesign -s "$CSC_NAME"` can
# find it. Do not mark the cert trusted: user-domain hangs for a GUI on GitHub
# macos runners, and the admin trust-settings write is denied (err -60005).
# electron-builder's find-identity -v will still ignore this identity; afterPack
# signs with codesign directly.
set -euo pipefail

if [[ -z "${CSC_LINK:-}" || -z "${CSC_KEY_PASSWORD:-}" || -z "${CSC_NAME:-}" ]]; then
  echo "Missing CSC_LINK, CSC_KEY_PASSWORD, or CSC_NAME" >&2
  exit 1
fi

workdir="${RUNNER_TEMP:-/tmp}/orca-fork-codesign"
mkdir -p "$workdir"
p12="$workdir/identity.p12"

if ! printf '%s' "$CSC_LINK" | base64 --decode > "$p12" 2>/dev/null; then
  printf '%s' "$CSC_LINK" | base64 -d > "$p12"
fi

kc="$workdir/fork-codesign.keychain-db"
if [[ ! -f "$kc" ]]; then
  security create-keychain -p 'fork-tmp' "$kc"
fi
security set-keychain-settings -lut 21600 "$kc"
security unlock-keychain -p 'fork-tmp' "$kc"
security import "$p12" -k "$kc" -P "$CSC_KEY_PASSWORD" -A -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k 'fork-tmp' "$kc" >/dev/null

existing=$(security list-keychains -d user | sed 's/"//g')
# shellcheck disable=SC2086
security list-keychains -d user -s "$kc" $existing

if ! security find-identity -p codesigning "$kc" | grep -F "$CSC_NAME" >/dev/null; then
  echo "Self-signed identity not imported: $CSC_NAME" >&2
  security find-identity -p codesigning "$kc" >&2
  exit 1
fi

echo "Imported self-signed identity: $CSC_NAME"
