#!/usr/bin/env bash
# Make the Google Play upload key, once (features/sidecar-android-app,
# "Releasing"). Run it yourself: it asks for the password, keeps the key
# outside the repo, and writes the git-ignored keystore.properties that
# `./gradlew :app:bundleRelease` signs with.
#
# The upload key is not the app's signing key: with Play App Signing, Google
# holds that one and only checks uploads against this. A lost or leaked
# upload key can be reset from the Play Console. Back it up all the same.
#
#   tools/sidecar-android/scripts/make-upload-key.sh [keystore path]
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
store="${1:-$HOME/.config/bfstats-release/upload.jks}"
props="$here/keystore.properties"
alias_name="upload"

keytool="$(command -v keytool || true)"
[ -n "$keytool" ] || { echo "keytool not found: install a JDK (it ships with one)"; exit 1; }
[ -e "$store" ] && { echo "$store already exists; refusing to overwrite it"; exit 1; }

read -r -s -p "Password for the upload key (6+ characters): " pw; echo
read -r -s -p "Again: " pw2; echo
[ "$pw" = "$pw2" ] || { echo "the two passwords differ"; exit 1; }
[ "${#pw}" -ge 6 ] || { echo "too short"; exit 1; }

mkdir -p "$(dirname "$store")"
chmod 700 "$(dirname "$store")"
# 25 years, as Play asks of upload keys. The name is the public alias.
"$keytool" -genkeypair -v -keystore "$store" -storetype PKCS12 -alias "$alias_name" \
  -keyalg RSA -keysize 4096 -validity 9125 \
  -dname "CN=bfstats.io, O=bfstats.io" \
  -storepass "$pw" -keypass "$pw" >/dev/null
chmod 600 "$store"

umask 077
cat > "$props" <<EOF
storeFile=$store
storePassword=$pw
keyAlias=$alias_name
keyPassword=$pw
EOF

echo "upload key: $store"
echo "signing config: $props (git-ignored)"
echo
echo "Back up $store and its password somewhere safe (a password manager)."
echo "For CI, add these GitHub repository secrets (Settings > Secrets and variables > Actions):"
echo "  SIDECAR_UPLOAD_KEYSTORE_B64   the output of: base64 -w0 '$store'"
echo "  SIDECAR_UPLOAD_STORE_PASSWORD the password you just typed"
