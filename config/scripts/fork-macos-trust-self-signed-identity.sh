#!/usr/bin/env bash
# Trust the fork desktop self-signed identity so `security find-identity -v`
# lists it. electron-builder ignores untrusted identities.
set -euo pipefail

if [[ -z "${CSC_LINK:-}" || -z "${CSC_KEY_PASSWORD:-}" || -z "${CSC_NAME:-}" ]]; then
  echo "Missing CSC_LINK, CSC_KEY_PASSWORD, or CSC_NAME" >&2
  exit 1
fi

workdir="${RUNNER_TEMP:-/tmp}/orca-fork-codesign"
mkdir -p "$workdir"
p12="$workdir/identity.p12"
pem="$workdir/identity.pem"
passfile="$workdir/p12-password"
printf '%s' "$CSC_KEY_PASSWORD" > "$passfile"
chmod 600 "$passfile"

if ! printf '%s' "$CSC_LINK" | base64 --decode > "$p12" 2>/dev/null; then
  printf '%s' "$CSC_LINK" | base64 -d > "$p12"
fi

extract_cert() {
  openssl pkcs12 -in "$p12" -clcerts -nokeys -out "$pem" -passin "file:$passfile" 2>/dev/null && return 0
  openssl pkcs12 -legacy -in "$p12" -clcerts -nokeys -out "$pem" -passin "file:$passfile" 2>/dev/null && return 0
  return 1
}

if ! extract_cert; then
  echo "Could not extract the self-signed certificate from CSC_LINK" >&2
  exit 1
fi

# User-domain add-trusted-cert waits for a GUI on GitHub macos runners
# (v1.4.190-7 hung until the 90m job timeout). Admin store + a 30s bound.
python3 - "$pem" <<'PY'
import subprocess
import sys

pem = sys.argv[1]
commands = (
    (
        "sudo",
        "security",
        "authorizationdb",
        "write",
        "com.apple.trust-settings.admin",
        "allow",
    ),
    (
        "sudo",
        "security",
        "add-trusted-cert",
        "-d",
        "-r",
        "trustRoot",
        "-p",
        "codeSign",
        "-k",
        "/Library/Keychains/System.keychain",
        pem,
    ),
)
for command in commands:
    try:
        subprocess.run(command, check=True, timeout=30)
    except subprocess.TimeoutExpired:
        print("Timed out trusting the self-signed identity (GUI prompt?)", file=sys.stderr)
        sys.exit(1)
PY

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

if ! security find-identity -v -p codesigning "$kc" | grep -F "$CSC_NAME" >/dev/null; then
  echo "Self-signed identity not valid after trust: $CSC_NAME" >&2
  security find-identity -p codesigning "$kc" >&2
  exit 1
fi

echo "Trusted self-signed identity: $CSC_NAME"
