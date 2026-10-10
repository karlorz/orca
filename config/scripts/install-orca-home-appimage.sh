#!/usr/bin/env bash
# Install a checksum-verified fork AppImage and retain its restore pin under HOME.
set -euo pipefail

ROOT="${ORCA_HOME_INSTALL_DIR:-$HOME/.local/opt/orca}"
IMAGE="$ROOT/orca-linux.AppImage"
PIN="$ROOT/release-tag"
SHA="$ROOT/appimage.sha256"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:---ensure}"
TAG=""
LAUNCHER="$HOME/bin/orca-ide-newbie"

fail() { printf 'orca-home: %s\n' "$*" >&2; exit 1; }
valid_tag() { [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[0-9]+$ ]]; }
healthy() {
  [[ ! -e "$ROOT/.install-pending" ]] || return 1
  [[ -f "$IMAGE" && -x "$IMAGE" && -f "$PIN" && -f "$SHA" ]] || return 1
  valid_tag "$(cat "$PIN")" || return 1
  (cd "$ROOT" && sha256sum --check --status appimage.sha256)
}

case "$MODE" in
  --check) healthy; exit ;;
  --ensure|--latest|--tag) ;;
  *) echo "usage: $0 [--check|--ensure|--latest|--tag vX.Y.Z-N]" >&2; exit 64 ;;
esac
if [[ "$MODE" == --tag ]]; then
  [[ $# == 2 ]] || fail '--tag requires one release tag'
  TAG="$2"
  valid_tag "$TAG" || fail 'expected a fork desktop tag vX.Y.Z-N'
elif [[ $# -gt 1 ]]; then
  fail 'unexpected arguments'
fi
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail 'fork AppImage releases currently support Linux x86_64'
[[ "$(realpath -m -- "$ROOT")" == "$(realpath -- "$HOME")/"* ]] || fail 'install directory must be inside HOME'
[[ -f "$SCRIPT_DIR/orca-home-launcher.sh" ]] || fail 'orca-home-launcher.sh must be beside the installer'
for tool in sha256sum flock; do command -v "$tool" >/dev/null || fail "$tool is required"; done
mkdir -p "$ROOT" "$HOME/bin"
exec 9>"$ROOT/.install.lock"
flock -n 9 || fail 'another home installer is running'

STAGE=""
cleanup() { [[ -z "$STAGE" ]] || rm -rf -- "$STAGE"; }
trap cleanup EXIT

install_launcher() {
  if [[ -e "$LAUNCHER" && ! -f "$LAUNCHER.pre-appimage" ]]; then
    cp -p -- "$LAUNCHER" "$LAUNCHER.pre-appimage"
  fi
  local temp
  temp=$(mktemp "$HOME/bin/.orca-ide-newbie.XXXXXX")
  cp -- "$SCRIPT_DIR/orca-home-launcher.sh" "$temp"
  chmod 755 "$temp"
  mv -f -- "$temp" "$LAUNCHER"
}

if [[ "$MODE" == --ensure ]] && healthy; then
  install_launcher
  printf 'orca-home: verified %s (offline)\n' "$(cat "$PIN")"
  exit 0
fi
if [[ "$MODE" == --ensure && -f "$PIN" ]]; then
  TAG=$(cat "$PIN")
  valid_tag "$TAG" || fail 'invalid saved release-tag; select a valid tag explicitly'
fi
command -v gh >/dev/null || fail 'gh is required to download fork releases'
STAGE=$(mktemp -d "$ROOT/.download.XXXXXX")
if [[ -z "$TAG" ]]; then
  # Include published prereleases; filter out upstream mirror and mobile tags.
  gh api 'repos/karlorz/orca/releases?per_page=100' >"$STAGE/releases.json"
  TAG=$(node - "$STAGE/releases.json" <<'NODE'
const fs = require('node:fs')
const releases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const candidates = releases.filter((release) => !release.draft &&
  /^v\d+\.\d+\.\d+-\d+$/.test(release.tag_name) &&
  ['orca-linux.AppImage', 'SHA256SUMS.txt'].every((name) => release.assets.some((asset) => asset.name === name)))
const parts = (tag) => tag.slice(1).split(/[.-]/).map(Number)
candidates.sort((a, b) => {
  const left = parts(a.tag_name), right = parts(b.tag_name)
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return right[i] - left[i]
  }
  return 0
})
if (!candidates.length) throw new Error('No published fork desktop AppImage in the latest 100 releases; use --tag')
process.stdout.write(candidates[0].tag_name)
NODE
  )
fi
valid_tag "$TAG" || fail 'no valid fork desktop release selected'
gh release download "$TAG" --repo karlorz/orca --dir "$STAGE" \
  --pattern orca-linux.AppImage --pattern SHA256SUMS.txt
awk '$2 == "orca-linux.AppImage" && $1 ~ /^[0-9a-fA-F]+$/ && length($1) == 64 {print $1 "  orca-linux.AppImage"; count++} END {if (count != 1) exit 1}' \
  "$STAGE/SHA256SUMS.txt" >"$STAGE/appimage.sha256" || fail 'missing or ambiguous AppImage checksum'
(cd "$STAGE" && sha256sum --check --status appimage.sha256) || fail 'AppImage checksum mismatch'
chmod 755 "$STAGE/orca-linux.AppImage"
printf '%s\n' "$TAG" >"$STAGE/release-tag"

# Verify the AppImage identity before switching any launcher or saved pin.
(cd "$STAGE" && ./orca-linux.AppImage --appimage-extract resources/package-type >/dev/null)
[[ "$(cat "$STAGE/squashfs-root/resources/package-type")" == AppImage ]] || fail 'expected an AppImage package-type marker'

if healthy && ! cmp -s -- "$IMAGE" "$STAGE/orca-linux.AppImage"; then
  cp -p -- "$IMAGE" "$ROOT/orca-linux.AppImage.previous"
  [[ ! -f "$PIN" ]] || cp -p -- "$PIN" "$ROOT/release-tag.previous"
  [[ ! -f "$SHA" ]] || cp -p -- "$SHA" "$ROOT/appimage.sha256.previous"
fi
printf '%s\n' "$TAG" >"$ROOT/.install-pending"
mv -f -- "$STAGE/orca-linux.AppImage" "$IMAGE"
mv -f -- "$STAGE/appimage.sha256" "$SHA"
mv -f -- "$STAGE/release-tag" "$PIN"
rm -f -- "$ROOT/.install-pending"
install_launcher
printf 'orca-home: installed %s at %s; GUI restart is manual\n' "$TAG" "$IMAGE"
