#!/usr/bin/env bash
# Home AppImage restore entry point; the saved legacy script owns profile recovery.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$HERE/install-orca-home-appimage.sh"
LEGACY="$HERE/orca-box-ensure-deb.sh"
PROFILE="${ORCA_PROFILE_DIR:-$HOME/orca-ide-profile/Fork-5}"
ROOT="${ORCA_HOME_INSTALL_DIR:-$HOME/.local/opt/orca}"

has_profile() { compgen -G "$PROFILE/profiles/*/profile-state.db" >/dev/null; }
home_installed() { bash "$INSTALLER" --check; }
installed() {
  if [[ -f "$ROOT/release-tag" ]]; then home_installed && [[ -x "$HOME/bin/orca-ide-newbie" ]]
  else home_installed || [[ -x /opt/Orca/orca-ide ]]; fi
}
legacy() {
  [[ -x "$LEGACY" ]] || { echo 'orca-box: saved orca-box-ensure-deb.sh is required for profile restore/deb fallback' >&2; return 1; }
  "$LEGACY" "$@"
}
check() {
  if home_installed; then
    echo "orca-home=verified tag=$(cat "$ROOT/release-tag") path=$ROOT/orca-linux.AppImage"
  else
    echo "orca-home=missing-or-unverified path=$ROOT/orca-linux.AppImage"
  fi
  echo "orca-opt-fallback=$([[ -x /opt/Orca/orca-ide ]] && echo present || echo missing)"
  if [[ -x "$LEGACY" ]]; then legacy --check
  else echo "orca-profile=$(has_profile && echo present || echo missing) ($PROFILE)"; fi
}
install_home() {
  if bash "$INSTALLER" --ensure; then return 0; fi
  if [[ -x /opt/Orca/orca-ide ]]; then
    echo 'orca-box: home install failed; existing /opt fallback is available' >&2
  fi
  return 1
}

case "${1:---check}" in
  --check) check ;;
  --installed) installed ;;
  --install) install_home ;;
  --install-deb) legacy --install ;;
  --restore-profile) legacy --restore-profile ;;
  --apply)
    rc=0
    install_home || rc=1
    legacy --restore-profile || rc=1
    check
    exit "$rc" ;;
  *) echo "usage: $0 [--check|--installed|--install|--install-deb|--restore-profile|--apply]" >&2; exit 64 ;;
esac
