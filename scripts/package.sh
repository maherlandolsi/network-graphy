#!/bin/sh
# Builds dist/network-plus-<version>.zip, ready to upload to addons.mozilla.org for signing.
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/network-plus-$VERSION.zip"
node --test test/*.test.js >/dev/null || { echo "Unit tests failed; not packaging." >&2; exit 1; }
mkdir -p dist
rm -f "$OUT"
zip -qr -X "$OUT" manifest.json background.js devtools panel lib content icons -x '*.DS_Store'
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
