#!/usr/bin/env bash
# Box desktop/profile launcher; /opt remains a manual rollback target.
set -euo pipefail
export DISPLAY="${DISPLAY:-:5}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime-5}"
export BAMF_DESKTOP_FILE_HINT="$HOME/.local/share/applications/box-orca-ide.desktop"
export ORCA_USER_DATA_PATH="${ORCA_USER_DATA_PATH:-$HOME/orca-ide-profile/Fork-5}"
ROOT="${ORCA_HOME_INSTALL_DIR:-$HOME/.local/opt/orca}"
IMAGE="$ROOT/orca-linux.AppImage"

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  for pid in $(pgrep -u "$(id -u)" -x xfwm4 2>/dev/null || true); do
    session=$(tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null || true)
    if printf '%s\n' "$session" | grep -qx "DISPLAY=$DISPLAY"; then
      DBUS_SESSION_BUS_ADDRESS=$(printf '%s\n' "$session" | awk '/^DBUS_SESSION_BUS_ADDRESS=/ {sub(/^[^=]*=/, ""); print; exit}')
      export DBUS_SESSION_BUS_ADDRESS
      break
    fi
  done
fi

cli=0
case "${1:-}" in
  --help|-h|--version|-v|help|version|auth|env)
    cli=1 ;;
  account|agent|agent-context|artifacts|automations|back|browser|capture|check|claude-teams|clear|click|clipboard|computer|console|cookie|dblclick|diagnostics|dialog|download|drag|emulator|environment|eval|exec|file|fill|find|focus|forward|full-screenshot|geolocation|get|goto|highlight|host|hover|inserttext|intercept|is|keypress|linear|mouse|network|open|open-url|orchestration|pdf|profile|project|reload|repo|screenshot|scroll|scrollintoview|search|select|select-all|set|skills|snapshot|status|storage|tab|terminal|type|uncheck|upload|viewport|vm|wait|worktree)
    cli=1 ;;
esac
if [[ "${ORCA_HOME_USE_OPT_FALLBACK:-0}" == 1 || ! -x "$IMAGE" ]]; then
  unset ORCA_HOME_INSTALL_MANAGED
  if [[ "$cli" == 1 ]]; then exec /usr/bin/orca-ide "$@"; fi
  exec /opt/Orca/orca-ide "--user-data-dir=$ORCA_USER_DATA_PATH" "$@"
fi

# Preserve AppImage runtime identity on hosts without FUSE; never stamp a deb marker.
if [[ "${APPIMAGE_EXTRACT_AND_RUN:-1}" == 1 ]]; then
  export APPIMAGE_EXTRACT_AND_RUN=1
else
  unset APPIMAGE_EXTRACT_AND_RUN
fi
export ORCA_HOME_INSTALL_MANAGED=1
unset LD_LIBRARY_PATH
# This box restricts user namespaces; opt out explicitly on hosts with a working sandbox.
flags=()
[[ "${ORCA_HOME_NO_SANDBOX:-1}" != 1 ]] || flags+=(--no-sandbox)
if [[ "$cli" == 1 ]]; then exec "$IMAGE" "${flags[@]}" "$@"; fi
exec "$IMAGE" "${flags[@]}" "--user-data-dir=$ORCA_USER_DATA_PATH" "$@"
