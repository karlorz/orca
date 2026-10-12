#!/usr/bin/env bash
set -euo pipefail

workdir="${RUNNER_TEMP:?}/orca-fork-codesign"
kc="$workdir/fork-codesign.keychain-db"
status=0
if [[ -f "$workdir/original-keychains.txt" ]]; then
  keychains=()
  while IFS= read -r keychain; do
    keychains+=("$keychain")
  done < "$workdir/original-keychains.txt"
  security list-keychains -d user -s "${keychains[@]}" || status=1
fi
if [[ -f "$kc" ]]; then
  security delete-keychain "$kc" || status=1
fi
rm -f "$workdir/identity.p12" "$workdir/original-keychains.txt" || status=1
if [[ -e "$kc" || -e "$workdir/identity.p12" ]]; then
  status=1
fi
rmdir "$workdir" 2>/dev/null || true
if [[ "$status" != 0 ]]; then
  echo 'Temporary signing identity cleanup incomplete' >&2
  exit 1
fi
echo 'Temporary fork signing identity removed and keychain search list restored'
