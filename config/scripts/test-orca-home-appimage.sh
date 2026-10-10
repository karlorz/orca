#!/usr/bin/env bash
# Light install/restore contracts with local release fixtures and no network or GUI.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TEMP=$(mktemp -d)
trap 'rm -rf -- "$TEMP"' EXIT
export HOME="$TEMP/home with spaces"
unset ORCA_USER_DATA_PATH ORCA_HOME_INSTALL_MANAGED ORCA_HOME_NO_SANDBOX ORCA_HOME_USE_OPT_FALLBACK
export PATH="$TEMP/tools:$PATH"
export ORCA_HOME_INSTALL_DIR="$HOME/.local/opt/orca"
export FIXTURES="$TEMP/fixtures"
export CALLS="$TEMP/calls"
mkdir -p "$HOME" "$TEMP/tools" "$FIXTURES"
cat >"$FIXTURES/orca-linux.AppImage" <<'IMAGE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --appimage-extract ]]; then
  mkdir -p squashfs-root/resources
  printf '%s\n' "${FIXTURE_MARKER:-AppImage}" >squashfs-root/resources/package-type
else
  printf '%s\n' "$ORCA_USER_DATA_PATH" "$ORCA_HOME_INSTALL_MANAGED" "$APPIMAGE_EXTRACT_AND_RUN" >>"$CALLS"
  printf '<%s>\n' "$@" >>"$CALLS"
fi
IMAGE
(cd "$FIXTURES" && sha256sum orca-linux.AppImage >SHA256SUMS.txt)
cat >"$TEMP/tools/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$CALLS"
[[ "${FAIL_DOWNLOAD:-0}" != 1 ]] || exit 1
if [[ "$1" == api ]]; then
  cat <<'JSON'
[
 {"tag_name":"v1.4.223","draft":false,"assets":[{"name":"orca-linux.AppImage"},{"name":"SHA256SUMS.txt"}]},
 {"tag_name":"v1.4.999-1","draft":true,"assets":[{"name":"orca-linux.AppImage"},{"name":"SHA256SUMS.txt"}]},
 {"tag_name":"mobile-android-v9.0.0-0","draft":false,"assets":[{"name":"orca-mobile.apk"}]},
 {"tag_name":"v1.4.223-0","draft":false,"assets":[{"name":"orca-linux.AppImage"}]},
 {"tag_name":"v1.4.222-9","draft":false,"assets":[{"name":"orca-linux.AppImage"},{"name":"SHA256SUMS.txt"}]},
 {"tag_name":"v1.4.222-10","draft":false,"assets":[{"name":"orca-linux.AppImage"},{"name":"SHA256SUMS.txt"}]}
]
JSON
else
  while [[ "$1" != --dir ]]; do shift; done
  cp "$FIXTURES/orca-linux.AppImage" "$FIXTURES/SHA256SUMS.txt" "$2/"
fi
GH
cat >"$TEMP/tools/sudo" <<'SUDO'
#!/usr/bin/env bash
exit 99
SUDO
chmod +x "$TEMP/tools/gh" "$TEMP/tools/sudo"
run() { bash "$HERE/install-orca-home-appimage.sh" "$@"; }
expect_failure() { if "$@"; then echo "unexpected success: $*" >&2; exit 1; fi; }

run --latest
[[ "$(cat "$ORCA_HOME_INSTALL_DIR/release-tag")" == v1.4.222-10 ]]
[[ -x "$HOME/bin/orca-ide-newbie" ]]
run --check
: >"$CALLS"
run --ensure
[[ ! -s "$CALLS" ]]

rm "$ORCA_HOME_INSTALL_DIR/orca-linux.AppImage"
run --ensure
grep -q 'release download v1.4.222-10' "$CALLS"
[[ "$(cat "$ORCA_HOME_INSTALL_DIR/release-tag")" == v1.4.222-10 ]]

# Integrity/marker/download failures preserve the current image, pin, and launcher.
BEFORE=$(sha256sum "$ORCA_HOME_INSTALL_DIR/orca-linux.AppImage" "$HOME/bin/orca-ide-newbie")
cp "$FIXTURES/SHA256SUMS.txt" "$FIXTURES/good-sha"
printf '%064d  orca-linux.AppImage\n' 0 >"$FIXTURES/SHA256SUMS.txt"
expect_failure run --tag v1.4.223-1
cp "$FIXTURES/good-sha" "$FIXTURES/SHA256SUMS.txt"
export FIXTURE_MARKER=deb
expect_failure run --tag v1.4.223-1
unset FIXTURE_MARKER
export FAIL_DOWNLOAD=1
expect_failure run --tag v1.4.223-1
unset FAIL_DOWNLOAD
[[ "$BEFORE" == "$(sha256sum "$ORCA_HOME_INSTALL_DIR/orca-linux.AppImage" "$HOME/bin/orca-ide-newbie")" ]]
[[ "$(cat "$ORCA_HOME_INSTALL_DIR/release-tag")" == v1.4.222-10 ]]
expect_failure run --tag mobile-android-v0.0.52-1

: >"$CALLS"
bash "$HOME/bin/orca-ide-newbie" 'orca://a path'
grep -Fxq "$HOME/orca-ide-profile/Fork-5" "$CALLS"
grep -Fxq "<--user-data-dir=$HOME/orca-ide-profile/Fork-5>" "$CALLS"
grep -Fxq '<orca://a path>' "$CALLS"
grep -Fxq '<--no-sandbox>' "$CALLS"
: >"$CALLS"
ORCA_HOME_NO_SANDBOX=0 bash "$HOME/bin/orca-ide-newbie" --version
grep -Fxq '<--version>' "$CALLS"
if grep -q 'user-data-dir\|no-sandbox' "$CALLS"; then exit 1; fi

: >"$CALLS"
bash "$HOME/bin/orca-ide-newbie" serve
grep -Fxq "<--user-data-dir=$HOME/orca-ide-profile/Fork-5>" "$CALLS"
grep -Fxq '<serve>' "$CALLS"

# Keep only verified bytes as the previous image.
printf '\n# next release\n' >>"$FIXTURES/orca-linux.AppImage"
(cd "$FIXTURES" && sha256sum orca-linux.AppImage >SHA256SUMS.txt)
run --tag v1.4.223-1
[[ -f "$ORCA_HOME_INSTALL_DIR/orca-linux.AppImage.previous" ]]
[[ "$(cat "$ORCA_HOME_INSTALL_DIR/release-tag.previous")" == v1.4.222-10 ]]
PREVIOUS=$(sha256sum "$ORCA_HOME_INSTALL_DIR/orca-linux.AppImage.previous")

# An interrupted three-file switch fails health checks and repairs the saved pin.
printf 'v1.4.224-1\n' >"$ORCA_HOME_INSTALL_DIR/.install-pending"
expect_failure run --check
run --ensure
[[ ! -f "$ORCA_HOME_INSTALL_DIR/.install-pending" ]]
[[ "$(cat "$ORCA_HOME_INSTALL_DIR/release-tag")" == v1.4.223-1 ]]

# A saved pin requires home repair even when the host still has /opt.
bash "$HERE/orca-box-ensure.sh" --installed
printf 'corrupt' >>"$ORCA_HOME_INSTALL_DIR/orca-linux.AppImage"
expect_failure bash "$HERE/orca-box-ensure.sh" --installed
run --ensure
run --check
[[ "$PREVIOUS" == "$(sha256sum "$ORCA_HOME_INSTALL_DIR/orca-linux.AppImage.previous")" ]]

# Competing installers fail before a download or launcher replacement.
flock "$ORCA_HOME_INSTALL_DIR/.install.lock" bash -c '
  if bash "$1" --ensure; then exit 1; fi
' _ "$HERE/install-orca-home-appimage.sh"
printf 'home AppImage install/restore/launcher contracts passed\n'
