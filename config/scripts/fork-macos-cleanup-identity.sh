#!/usr/bin/env bash
set -euo pipefail

workdir="${RUNNER_TEMP:?}/orca-fork-codesign"
kc="$workdir/fork-codesign.keychain-db"
if [[ -f "$workdir/original-keychains.txt" ]]; then
  keychains=()
  while IFS= read -r keychain; do
    keychains+=("$keychain")
  done < "$workdir/original-keychains.txt"
  security list-keychains -d user -s "${keychains[@]}"
fi
if [[ -f "$kc" ]]; then
  security delete-keychain "$kc"
fi
rm -f "$workdir/identity.p12" "$workdir/original-keychains.txt"
rmdir "$workdir" 2>/dev/null || true
echo 'Temporary fork signing identity removed and keychain search list restored'
