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
CLI="$SCRIPT_DIR/orca-home-appimage-install-cli.mjs"
shared() { node "$CLI" "$@"; }
healthy() {
  [[ ! -e "$ROOT/.install-pending" ]] || return 1
  shared check "$ROOT" >/dev/null
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
command -v node >/dev/null || fail 'Node 24 is required'
[[ -f "$CLI" ]] || fail 'shared installer modules must be beside the shell script'
mkdir -p "$ROOT" "$HOME/bin"
mkdir "$ROOT/.install-lock" 2>/dev/null || fail 'another home updater holds .install-lock; attended recovery required after a crash'

STAGE=""
cleanup() {
  if [[ -n "$STAGE" && ! -e "$ROOT/.install-pending" ]]; then rm -rf -- "$STAGE"; fi
  rmdir "$ROOT/.install-lock"
}
trap cleanup EXIT
shared recover "$ROOT"

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

if [[ "$MODE" == --ensure ]]; then
  if shared reconcile "$ROOT" >/dev/null; then
    install_launcher
    printf 'orca-home: verified %s (offline)\n' "$(cat "$PIN")"
    exit 0
  fi
  if [[ -f "$ROOT/installed-release.json" ]]; then
    TAG=$(node - "$ROOT/installed-release.json" <<'NODE'
const fs = require('node:fs')
const identity = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (!/^v\d+\.\d+\.\d+-\d+$/.test(identity.tag) || !/^[a-f0-9]{64}$/.test(identity.sha256)) {
  throw new Error('Invalid saved identity; attended repair required')
}
process.stdout.write(identity.tag)
NODE
    )
  else
    [[ ! -e "$IMAGE" ]] || fail 'existing image identity is unverifiable; select a release explicitly'
    [[ -f "$PIN" ]] || fail 'missing release pin; select a release explicitly with --tag or --latest'
    TAG=$(cat "$PIN")
    valid_tag "$TAG" || fail 'invalid saved release-tag; select a valid tag explicitly'
  fi
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
# commit writes release-tag, appimage.sha256, and installed-release.json together.
shared commit "$ROOT" "$STAGE" "$TAG"
install_launcher
printf 'orca-home: installed %s at %s; GUI restart is manual\n' "$TAG" "$IMAGE"
