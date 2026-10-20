#!/usr/bin/env bash
# Sets the repository secrets for signed + notarized macOS builds in CI
# (build-platforms.yml, release.yml) and for the App Store upload (build-mas.yml).
# Run it yourself, on the Mac that holds the Developer ID certificate:
#
#   1. Keychain Access → "My Certificates" → right-click
#      "Developer ID Application: Felix Helleckes (5Y4L8J23FQ)" → Export… → .p12 with a password
#   2. scripts/set-mac-secrets.sh ~/Desktop/DeveloperID.p12
#   3. Delete the exported .p12 afterwards.
#
# Renewal: the Developer ID certificate expires — export the new one and run this again.
set -euo pipefail

P12="${1:?usage: scripts/set-mac-secrets.sh <exported Developer ID .p12>}"
KEY_ID=3UPD3SJ67A
ISSUER=7ec7cedf-030a-4f7a-a715-76355c7ed6b0
P8="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
REPO=Felix-Helleckes/ICQ

[ -f "$P12" ] || { echo "No such file: $P12" >&2; exit 1; }
[ -f "$P8" ]  || { echo "App Store Connect key missing: $P8" >&2; exit 1; }
gh auth status >/dev/null

read -rsp "Password of the .p12: " PW; echo
# Catch a typo early. Only a warning: macOS' LibreSSL cannot read every Keychain
# export format, so a failure here does not prove the password is wrong.
openssl pkcs12 -in "$P12" -nokeys -passin "pass:$PW" >/dev/null 2>&1 \
  || echo "Warning: could not verify the password with openssl — continuing." >&2

set_secret() { printf %s "$2" | gh secret set "$1" --repo "$REPO"; echo "  set $1"; }

# DMG signing + notarization
set_secret MAC_DEVID_CERT_P12      "$(base64 -i "$P12")"
set_secret MAC_DEVID_CERT_PASSWORD "$PW"
set_secret APPLE_API_KEY_P8        "$(base64 -i "$P8")"
set_secret APPLE_API_KEY_ID        "$KEY_ID"
set_secret APPLE_API_ISSUER        "$ISSUER"
# App Store Connect upload (build-mas.yml -f upload=true), same key
set_secret MAS_API_KEY_P8          "$(base64 -i "$P8")"
set_secret MAS_API_KEY_ID          "$KEY_ID"
set_secret MAS_API_ISSUER_ID       "$ISSUER"

gh secret list --repo "$REPO"
